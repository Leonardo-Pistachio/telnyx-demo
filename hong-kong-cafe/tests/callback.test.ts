import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestCallback } from "../src/core/callback-service";
import { createFakeEnvironment } from "./support/fake-env";

const CALL_ID = "v3:callback-test";

async function withSession(
  fake: ReturnType<typeof createFakeEnvironment>,
  token: string,
  callId = CALL_ID,
) {
  await fake.kv.put(
    `session/${token}`,
    JSON.stringify({ call_id: callId, created_at: "now" }),
  );
}

const ORIGINAL_ENV = {
  EMAIL_API_KEY: process.env.EMAIL_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  BOOKING_NOTIFICATION_EMAIL: process.env.BOOKING_NOTIFICATION_EMAIL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("callback requests", () => {
  beforeEach(() => {
    delete process.env.EMAIL_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.BOOKING_NOTIFICATION_EMAIL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv();
  });

  it("stores one callback per trusted call in the CallSession actor", async () => {
    const fake = createFakeEnvironment();
    const token = `sess_${crypto.randomUUID()}`;
    await withSession(fake, token);

    const first = await requestCallback(
      fake.env,
      token,
      "9123 4567",
      "Sam",
    );
    const retried = await requestCallback(
      fake.env,
      token,
      "9876 5432",
      "Sam",
    );

    expect(first).toMatchObject({ ok: true, status: "saved" });
    expect(retried).toMatchObject({ ok: true, status: "already_saved" });
    if (!first.ok || !retried.ok) return;
    expect(retried.callback.callback_id).toBe(first.callback.callback_id);

    const stored = fake.callSessions.get(CALL_ID)?.callbacks;
    expect(stored).toHaveLength(1);
    expect(stored?.[0]?.phone).toBe("+85291234567");
  });

  it("does not save without a valid session token", async () => {
    const fake = createFakeEnvironment();

    const result = await requestCallback(
      fake.env,
      `sess_${crypto.randomUUID()}`,
      "9123 4567",
    );

    expect(result).toMatchObject({ ok: false, code: "invalid_session" });
    expect(fake.callSessions.size).toBe(0);
  });

  it("rejects a phone number that is too short", async () => {
    const fake = createFakeEnvironment();
    const token = `sess_${crypto.randomUUID()}`;
    await withSession(fake, token);

    const result = await requestCallback(fake.env, token, "1210");

    expect(result).toMatchObject({ ok: false, code: "invalid_phone" });
    expect(fake.callSessions.get(CALL_ID)?.callbacks ?? []).toHaveLength(0);
  });

  it("emails the callback once on the first save only", async () => {
    process.env.EMAIL_API_KEY = "re_test";
    process.env.BOOKING_NOTIFICATION_EMAIL = "jackchan12382@gmail.com";

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "email_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const fake = createFakeEnvironment();
    const token = `sess_${crypto.randomUUID()}`;
    await withSession(fake, token);

    const first = await requestCallback(
      fake.env,
      token,
      "9123 4567",
      "Sam",
    );
    await requestCallback(fake.env, token, "9123 4567", "Sam");

    expect(first).toMatchObject({ ok: true, status: "saved" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as {
      to: string[];
      subject: string;
      text: string;
    };
    expect(body.to).toEqual(["jackchan12382@gmail.com"]);
    expect(body.subject).toContain("Sam");
    expect(body.text).toContain("+85291234567");
  });
});
