import { describe, expect, it } from "vitest";
import { CallSession } from "../src/actors/CallSession";

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

function createSession() {
  return new CallSession(
    { storage: new MemoryStorage() } as never,
    {} as never,
  );
}

describe("CallSession misunderstanding counter", () => {
  it("escalates exactly at three and does not reset or exceed three", async () => {
    const session = createSession();

    await expect(session.recordMisunderstanding()).resolves.toEqual({
      count: 1,
      shouldEscalate: false,
      newlyReachedThreshold: false,
    });
    await expect(session.recordMisunderstanding()).resolves.toEqual({
      count: 2,
      shouldEscalate: false,
      newlyReachedThreshold: false,
    });
    await expect(session.recordMisunderstanding()).resolves.toEqual({
      count: 3,
      shouldEscalate: true,
      newlyReachedThreshold: true,
    });
    await expect(session.recordMisunderstanding()).resolves.toEqual({
      count: 3,
      shouldEscalate: true,
      newlyReachedThreshold: false,
    });
    await expect(session.misunderstandingCount()).resolves.toBe(3);
  });
});
