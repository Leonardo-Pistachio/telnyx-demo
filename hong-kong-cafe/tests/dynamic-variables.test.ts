import { describe, expect, it } from "vitest";
import {
  buildDynamicVariables,
  RESERVATIONS_FLAG_KEY,
  SESSION_TOKEN_TTL_SECONDS,
} from "../src/core/dynamic-variables";

class MemoryKv {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; ttl?: number }> = [];

  constructor(private readonly failing = false) {}

  async get(key: string): Promise<string | null> {
    if (this.failing) throw new Error("kv unavailable");
    return this.values.get(key) ?? null;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    if (this.failing) throw new Error("kv unavailable");
    this.values.set(key, value);
    this.writes.push({ key, ttl: options?.expirationTtl });
  }
}

describe("dynamic variables", () => {
  it("fails closed when the flag is absent", async () => {
    const kv = new MemoryKv();
    const result = await buildDynamicVariables(
      { callControlId: "call-1" },
      {
        kv: kv as never,
        now: new Date("2026-11-09T04:00:00.000Z"),
        createToken: () => "session-token",
      },
    );

    expect(result.variables.reservations_enabled).toBe("false");
    expect(result.variables.call_support_available).toBe("true");
    expect(result.variables.today_date).toBe("2026-11-09");
    expect(kv.writes).toContainEqual({
      key: "session/session-token",
      ttl: SESSION_TOKEN_TTL_SECONDS,
    });
  });

  it("enables reservations only for the exact true flag", async () => {
    const kv = new MemoryKv();
    kv.values.set(RESERVATIONS_FLAG_KEY, "true");

    const result = await buildDynamicVariables(
      { callControlId: "call-1" },
      { kv: kv as never, createToken: () => "session-token" },
    );

    expect(result.variables.reservations_enabled).toBe("true");
  });

  it("disables session support when KV fails", async () => {
    const kv = new MemoryKv(true);

    const result = await buildDynamicVariables(
      { callControlId: "call-1" },
      { kv: kv as never, createToken: () => "session-token" },
    );

    expect(result.variables.reservations_enabled).toBe("false");
    expect(result.variables.call_support_available).toBe("false");
    expect(result.variables.call_session_token).toBe("");
    expect(result.featureFlagFailed).toBe(true);
    expect(result.sessionFailed).toBe(true);
  });
});
