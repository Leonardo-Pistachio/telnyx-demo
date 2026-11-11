import { describe, expect, it } from "vitest";
import {
  findAvailability,
  freeTimesForDate,
  nearestTimes,
  type DateSeatUsage,
} from "../src/core/availability";
import { BOOKABLE_TIMES } from "../src/core/reservations";
import { getHongKongNow } from "../src/lib/time";

const NOW = getHongKongNow(new Date("2026-11-09T02:00:00.000Z"));

function fullDate(partySize: number): DateSeatUsage {
  return Object.fromEntries(
    BOOKABLE_TIMES.map((time) => [time, partySize]),
  );
}

describe("availability", () => {
  it("filters slots already in the past today", () => {
    const now = getHongKongNow(new Date("2026-11-09T05:00:00.000Z"));
    const free = freeTimesForDate("2026-11-09", 2, {}, now);
    expect(free).toContain("13:30");
    expect(free).not.toContain("12:30");
  });

  it("orders nearby times by distance and then time", () => {
    expect(
      nearestTimes("18:00", ["19:00", "17:30", "18:30", "17:00"]),
    ).toEqual(["17:30", "18:30", "17:00"]);
  });

  it("returns a selection when the requested slot can fit", async () => {
    const result = await findAvailability(
      "2026-11-10",
      "18:00",
      4,
      async () => ({}),
      NOW,
    );

    expect(result.ok && result.requested_available).toBe(true);
    expect(result.ok && result.alternatives).toEqual([]);
    expect(result.ok && result.selected?.time).toBe("18:00");
  });

  it("returns same-day alternatives when the requested slot is full", async () => {
    const usage: DateSeatUsage = {
      "18:00": 40,
      "18:30": 40,
      "19:00": 40,
    };
    const result = await findAvailability(
      "2026-11-10",
      "18:00",
      2,
      async () => usage,
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.requested_available).toBe(false);
    expect(result.selected).toBeNull();
    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.alternatives.length).toBeLessThanOrEqual(3);
    expect(result.alternatives.every((slot) => slot.date === "2026-11-10")).toBe(
      true,
    );
    expect(result.alternatives[0]?.time).toBe("17:00");
    expect(
      result.alternatives.some((slot) => slot.time === "18:00"),
    ).toBe(false);
  });

  it("rejects alternatives whose later occupied slot is full", async () => {
    const result = await findAvailability(
      "2026-11-10",
      "18:00",
      2,
      async () => ({ "18:30": 40 }),
      NOW,
    );

    expect(result.ok && result.requested_available).toBe(false);
    const times = result.ok ? result.alternatives.map((slot) => slot.time) : [];
    expect(times).not.toContain("18:00");
    expect(times).not.toContain("18:30");
    expect(times[0]).toBe("17:30");
  });

  it("searches following dates after the requested date is full", async () => {
    const result = await findAvailability(
      "2026-11-10",
      "18:00",
      4,
      async (date) => (date === "2026-11-10" ? fullDate(40) : {}),
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.alternatives[0]?.date).toBe("2026-11-11");
    expect(result.alternatives.length).toBeLessThanOrEqual(3);
  });

  it("does not search beyond the booking window", async () => {
    const result = await findAvailability(
      "2026-12-09",
      "18:00",
      2,
      async () => fullDate(40),
      NOW,
    );

    expect(result).toMatchObject({
      ok: true,
      requested_available: false,
      alternatives: [],
    });
  });

  it("checks every occupied slot for capacity", async () => {
    const result = await findAvailability(
      "2026-11-10",
      "18:00",
      2,
      async () => ({ "18:30": 40 }),
      NOW,
    );

    expect(result.ok && result.requested_available).toBe(false);
  });
});
