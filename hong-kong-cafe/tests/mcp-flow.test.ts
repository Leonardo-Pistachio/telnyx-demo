import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { addDays, getHongKongNow } from "../src/lib/time";
import { createFakeEnvironment } from "./support/fake-env";

const previousToken = process.env.MCP_API_KEY;

beforeAll(() => {
  process.env.MCP_API_KEY = "test-token";
});

afterAll(() => {
  if (previousToken === undefined) {
    delete process.env.MCP_API_KEY;
  } else {
    process.env.MCP_API_KEY = previousToken;
  }
});

async function callTool(
  env: ReturnType<typeof createFakeEnvironment>,
  id: number,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await app.request(
    "http://localhost/mcp",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    },
    env.env,
  );

  const body = (await response.json()) as {
    result: { isError?: boolean; content: Array<{ text: string }> };
  };
  return JSON.parse(body.result.content[0]!.text) as Record<string, unknown>;
}

describe("MCP business flow", () => {
  it("checks availability and books idempotently", async () => {
    const fake = createFakeEnvironment();
    const date = addDays(getHongKongNow().date, 2);

    const availability = await callTool(fake, 1, "check_availability", {
      date,
      time: "18:00",
      party_size: 4,
    });

    expect(availability.ok).toBe(true);
    const selectionToken = availability.selection_token as string;
    expect(selectionToken).toMatch(/^sel_/);

    const booked = await callTool(fake, 2, "create_reservation", {
      selection_token: selectionToken,
      name: "Ada Chan",
      phone: "+852 9123 4567",
    });
    expect(booked).toMatchObject({
      ok: true,
      status: "confirmed",
      reservation: { date, time: "18:00", party_size: 4 },
    });

    const retried = await callTool(fake, 3, "create_reservation", {
      selection_token: selectionToken,
      name: "Ada Chan",
      phone: "+852 9123 4567",
    });
    expect(retried).toMatchObject({
      ok: true,
      status: "already_confirmed",
    });

    expect(
      fake.dayBookings.get(date)?.reservations,
    ).toHaveLength(1);
  });

  it("records three misunderstandings for one trusted session", async () => {
    const fake = createFakeEnvironment();
    const token = `sess_${crypto.randomUUID()}`;
    await fake.kv.put(
      `session/${token}`,
      JSON.stringify({ call_id: "v3:trusted", created_at: "now" }),
    );

    const first = await callTool(fake, 1, "record_misunderstanding", {
      session_token: token,
      stage: "intent",
    });
    const third = await callTool(fake, 2, "record_misunderstanding", {
      session_token: token,
      stage: "intent",
    });
    const final = await callTool(fake, 3, "record_misunderstanding", {
      session_token: token,
      stage: "intent",
    });

    expect(first).toMatchObject({ ok: true, count: 1 });
    expect(third).toMatchObject({ ok: true, count: 2 });
    expect(final).toMatchObject({
      ok: true,
      count: 3,
      should_escalate: true,
    });
  });

  it("saves a callback against the token's trusted call", async () => {
    const fake = createFakeEnvironment();
    const token = `sess_${crypto.randomUUID()}`;
    await fake.kv.put(
      `session/${token}`,
      JSON.stringify({ call_id: "v3:trusted", created_at: "now" }),
    );

    const saved = await callTool(fake, 1, "request_callback", {
      session_token: token,
      phone: "9123 4567",
      name: "Bea",
    });
    const retried = await callTool(fake, 2, "request_callback", {
      session_token: token,
      phone: "9123 4567",
      name: "Bea",
    });

    expect(saved).toMatchObject({ ok: true, status: "saved" });
    expect(retried).toMatchObject({ ok: true, status: "already_saved" });
    expect(
      [...fake.kv.values.keys()].some((key) => key.startsWith("callback/")),
    ).toBe(true);
    const allValues = [...fake.kv.values.values()].join(" ");
    expect(allValues).not.toContain(token);
  });
});
