import { describe, expect, it } from "vitest";
import { CALLBACK_TTL_SECONDS, saveCallback } from "../src/core/callback";

class MemoryKv {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; ttl?: number }> = [];

  async get<T>(key: string, options?: { type?: "json" }): Promise<T | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return options?.type === "json" ? JSON.parse(value) : (value as T);
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    this.values.set(key, value);
    this.writes.push({ key, ttl: options?.expirationTtl });
  }
}

describe("callback records", () => {
  it("writes once with a 30-day TTL and is idempotent", async () => {
    const kv = new MemoryKv();
    const first = await saveCallback(
      kv as never,
      "call/private-id",
      "Sam",
      "9123 4567",
      new Date("2026-11-09T04:00:00.000Z"),
    );
    const second = await saveCallback(
      kv as never,
      "call/private-id",
      "Sam",
      "9123 4567",
    );

    expect(first.ok && first.status).toBe("saved");
    expect(second.ok && second.status).toBe("already_saved");
    expect(kv.writes).toHaveLength(1);
    expect(kv.writes[0]?.ttl).toBe(CALLBACK_TTL_SECONDS);
    expect(kv.writes[0]?.key).not.toContain("call/private-id");
  });

  it("does not overwrite a callback with a different number", async () => {
    const kv = new MemoryKv();
    await saveCallback(kv as never, "call-1", undefined, "+85291234567");

    const conflict = await saveCallback(
      kv as never,
      "call-1",
      undefined,
      "+85298765432",
    );

    expect(conflict).toMatchObject({ ok: false, code: "conflict" });
    expect(kv.writes).toHaveLength(1);
  });
});
