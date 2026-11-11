import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { addDays, getHongKongNow, weekdayForDate } from "../src/lib/time";
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

    const stored = fake.callSessions.get("v3:trusted")?.callbacks ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.phone).toBe("+85291234567");

    const allValues = [...fake.kv.values.values()].join(" ");
    expect(allValues).not.toContain(token);
  });

  it("limits each reservation to ten guests", async () => {
    const fake = createFakeEnvironment();
    const date = weekdayDate(2);

    const result = await callTool(fake, 1, "check_availability", {
      date,
      time: "18:00",
      party_size: 11,
    });

    expect(result).toMatchObject({ ok: false, issue: "party_too_large" });
  });

  it("stores seating and a special-occasion remark", async () => {
    const fake = createFakeEnvironment();
    const date = weekdayDate(2);

    const availability = await callTool(fake, 1, "check_availability", {
      date,
      time: "18:00",
      party_size: 4,
    });
    const selectionToken = availability.selection_token as string;

    const booked = await callTool(fake, 2, "create_reservation", {
      selection_token: selectionToken,
      name: "Ada Chan",
      phone: "+852 9123 4567",
      seating: "inside",
      remark: "Birthday dinner",
    });

    expect(booked).toMatchObject({
      ok: true,
      status: "confirmed",
      reservation: {
        seating: "inside",
        remark: "Birthday dinner",
      },
    });
    expect(booked).not.toHaveProperty("email_sent");
    expect(fake.dayBookings.get(date)?.reservations[0]).toMatchObject({
      seating: "inside",
      remark: "Birthday dinner",
    });

    const lookup = await callTool(fake, 3, "lookup_reservation", {
      name: "Chan",
      phone: "+852 9123 4567",
      date,
    });
    expect(lookup).toMatchObject({
      ok: true,
      reservation: {
        name: "Ada Chan",
        phone: "***4567",
        remark: "Birthday dinner",
      },
    });
  });

  it("refuses outdoor seating on a rainy weekend", async () => {
    const fake = createFakeEnvironment();
    const saturday = nextSaturday();

    const weather = await callTool(fake, 1, "check_weather", {
      date: saturday,
    });
    expect(weather).toMatchObject({ condition: "rainy", outdoor_open: false });

    const availability = await callTool(fake, 2, "check_availability", {
      date: saturday,
      time: "18:00",
      party_size: 2,
    });
    const selectionToken = availability.selection_token as string;

    const booked = await callTool(fake, 3, "create_reservation", {
      selection_token: selectionToken,
      name: "Ada Chan",
      phone: "+852 9123 4567",
      seating: "outside",
    });

    expect(booked).toMatchObject({ ok: false, code: "outdoor_unavailable" });
    expect(fake.dayBookings.get(saturday)?.reservations ?? []).toHaveLength(0);
  });

  it("moves a verified booking and blocks lookup without every factor", async () => {
    const fake = createFakeEnvironment();
    const date = weekdayDate(2);

    const availability = await callTool(fake, 1, "check_availability", {
      date,
      time: "18:00",
      party_size: 4,
    });
    const selectionToken = availability.selection_token as string;
    await callTool(fake, 2, "create_reservation", {
      selection_token: selectionToken,
      name: "Ada Chan",
      phone: "+852 9123 4567",
    });

    const blocked = await callTool(fake, 3, "lookup_reservation", {
      name: "Chan",
      phone: "+852 9000 0000",
      date,
    });
    expect(blocked).toMatchObject({ ok: false, code: "not_found" });

    const newDate = nextWeekdayAfter(date);
    const moved = await callTool(fake, 4, "change_reservation_date", {
      name: "Chan",
      phone: "+852 9123 4567",
      current_date: date,
      new_date: newDate,
    });
    expect(moved).toMatchObject({
      ok: true,
      status: "moved",
      reservation: { date: newDate, time: "18:00" },
    });

    const oldLookup = await callTool(fake, 5, "lookup_reservation", {
      name: "Chan",
      phone: "+852 9123 4567",
      date,
    });
    expect(oldLookup).toMatchObject({ ok: false, code: "not_found" });

    const newLookup = await callTool(fake, 6, "lookup_reservation", {
      name: "Chan",
      phone: "+852 9123 4567",
      date: newDate,
    });
    expect(newLookup).toMatchObject({ ok: true, reservation: { date: newDate } });
  });
});

function weekend(date: string): boolean {
  return weekdayForDate(date) === "Saturday" || weekdayForDate(date) === "Sunday";
}

function weekdayDate(offset: number): string {
  let date = addDays(getHongKongNow().date, offset);
  while (weekend(date)) date = addDays(date, 1);
  return date;
}

function nextWeekdayAfter(date: string): string {
  let candidate = addDays(date, 1);
  while (weekend(candidate)) candidate = addDays(candidate, 1);
  return candidate;
}

function nextSaturday(): string {
  let date = addDays(getHongKongNow().date, 1);
  while (weekdayForDate(date) !== "Saturday") date = addDays(date, 1);
  return date;
}
