import { describe, expect, it } from "vitest";
import { getHongKongNow } from "../src/lib/time";
import {
  BOOKABLE_TIMES,
  bookedSlotTimes,
  validateBookingRequest,
} from "../src/core/reservations";

const NOW = getHongKongNow(new Date("2026-11-09T02:00:00.000Z"));

describe("reservation validation", () => {
  it("accepts a valid future slot", () => {
    const result = validateBookingRequest("2026-11-09", "11:30", 4, NOW);
    expect(result).toEqual({
      ok: true,
      value: {
        date: "2026-11-09",
        time: "11:30",
        partySize: 4,
        slotTimes: ["11:30", "12:00", "12:30"],
      },
    });
  });

  it("includes the last reservation at 20:30 and nothing later", () => {
    expect(BOOKABLE_TIMES[0]).toBe("11:30");
    expect(BOOKABLE_TIMES.at(-1)).toBe("20:30");
    expect(bookedSlotTimes("20:30")).toEqual(["20:30", "21:00", "21:30"]);

    const tooLate = validateBookingRequest("2026-11-10", "21:00", 2, NOW);
    expect(tooLate).toMatchObject({ ok: false, issue: "invalid_time" });
  });

  it("rejects past times on today's Hong Kong date", () => {
    const result = validateBookingRequest("2026-11-09", "10:00", 2, NOW);
    expect(result).toMatchObject({ ok: false, issue: "invalid_time" });

    const noon = getHongKongNow(new Date("2026-11-09T04:00:00.000Z"));
    const elevenThirty = validateBookingRequest(
      "2026-11-09",
      "11:30",
      2,
      noon,
    );
    expect(elevenThirty).toMatchObject({ ok: false, issue: "past_time" });
  });

  it("accepts the inclusive 30-day boundary and rejects beyond it", () => {
    expect(
      validateBookingRequest("2026-12-09", "18:00", 2, NOW).ok,
    ).toBe(true);
    expect(
      validateBookingRequest("2026-12-10", "18:00", 2, NOW),
    ).toMatchObject({ ok: false, issue: "outside_window" });
    expect(
      validateBookingRequest("2026-11-08", "18:00", 2, NOW),
    ).toMatchObject({ ok: false, issue: "outside_window" });
  });

  it("distinguishes invalid party sizes from large-party routing", () => {
    expect(
      validateBookingRequest("2026-11-10", "18:00", 0, NOW),
    ).toMatchObject({ ok: false, issue: "invalid_party_size" });
    expect(
      validateBookingRequest("2026-11-10", "18:00", 2.5, NOW),
    ).toMatchObject({ ok: false, issue: "invalid_party_size" });
    expect(
      validateBookingRequest("2026-11-10", "18:00", 11, NOW),
    ).toMatchObject({ ok: false, issue: "party_too_large" });
  });
});
