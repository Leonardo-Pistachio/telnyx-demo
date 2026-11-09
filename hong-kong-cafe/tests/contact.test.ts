import { describe, expect, it } from "vitest";
import { normalizeContact, normalizePhone } from "../src/core/contact";

describe("contact normalization", () => {
  it("normalizes Hong Kong local numbers", () => {
    expect(normalizePhone("9123 4567")).toBe("+85291234567");
  });

  it("normalizes international numbers and punctuation", () => {
    expect(normalizePhone("+1 (415) 555-0132")).toBe("+14155550132");
    expect(normalizePhone("+852 9123-4567")).toBe("+85291234567");
  });

  it("rejects letters, short numbers, and absurdly long numbers", () => {
    expect(normalizePhone("call me")).toBeNull();
    expect(normalizePhone("1234")).toBeNull();
    expect(normalizePhone("+1234567890123456")).toBeNull();
  });

  it("requires a name only for reservations", () => {
    expect(
      normalizeContact(undefined, "9123 4567", false).ok,
    ).toBe(true);
    expect(
      normalizeContact(undefined, "9123 4567", true),
    ).toMatchObject({ ok: false, code: "invalid_name" });
  });
});
