import { describe, expect, it } from "vitest";
import {
  newSessionToken,
  readSelection,
  resolveSessionCallId,
  saveSelection,
  SELECTION_TOKEN_TTL_SECONDS,
} from "../src/core/tokens";

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

describe("trusted token mapping", () => {
  it("resolves a session token only to its stored call id", async () => {
    const kv = new MemoryKv();
    const token = newSessionToken();
    kv.values.set(
      `session/${token}`,
      JSON.stringify({ call_id: "v3:trusted", created_at: "now" }),
    );

    await expect(resolveSessionCallId(kv as never, token)).resolves.toBe(
      "v3:trusted",
    );
    await expect(
      resolveSessionCallId(kv as never, "sess_not-a-token"),
    ).resolves.toBeNull();
  });

  it("stores a selection with a ten-minute TTL", async () => {
    const kv = new MemoryKv();
    const token = await saveSelection(kv as never, {
      date: "2026-11-10",
      time: "18:00",
      party_size: 4,
      created_at: "now",
    });

    expect(kv.writes[0]?.ttl).toBe(SELECTION_TOKEN_TTL_SECONDS);
    await expect(readSelection(kv as never, token)).resolves.toMatchObject({
      date: "2026-11-10",
      time: "18:00",
      party_size: 4,
    });
  });
});
