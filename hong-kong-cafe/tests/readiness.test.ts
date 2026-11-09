import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { createFakeEnvironment } from "./support/fake-env";

const originalMCPKey = process.env.MCP_API_KEY;
const originalTelnyxKey = process.env.TELNYX_PUBLIC_KEY;

beforeAll(() => {
  process.env.MCP_API_KEY = "test-token";
  process.env.TELNYX_PUBLIC_KEY = "test-public-key";
});

afterAll(() => {
  if (originalMCPKey === undefined) delete process.env.MCP_API_KEY;
  else process.env.MCP_API_KEY = originalMCPKey;
  if (originalTelnyxKey === undefined) delete process.env.TELNYX_PUBLIC_KEY;
  else process.env.TELNYX_PUBLIC_KEY = originalTelnyxKey;
});

describe("readiness", () => {
  it("checks secrets, KV, and both actors", async () => {
    const fake = createFakeEnvironment();
    const response = await app.request(
      "http://localhost/readyz",
      {},
      fake.env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      checks: {
        secrets: true,
        kv: true,
        day_bookings: true,
        call_session: true,
      },
    });
  });
});
