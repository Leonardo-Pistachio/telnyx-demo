import { describe, expect, it } from "vitest";
import {
  addDays,
  getHongKongNow,
  isValidIsoDate,
  minutesToTime,
  timeToMinutes,
  weekdayForDate,
} from "../src/lib/time";

describe("Hong Kong time helpers", () => {
  it("renders the Hong Kong calendar date across UTC boundary", () => {
    const result = getHongKongNow(new Date("2026-11-09T17:30:00.000Z"));
    expect(result.date).toBe("2026-11-10");
    expect(result.time).toBe("01:30");
    expect(result.weekday).toBe("Tuesday");
  });

  it("validates real ISO dates", () => {
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2027-02-29")).toBe(false);
    expect(isValidIsoDate("2026-11-9")).toBe(false);
  });

  it("adds calendar days without timezone drift", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("resolves weekday from the calendar date", () => {
    expect(weekdayForDate("2026-11-09")).toBe("Monday");
  });

  it("converts valid times and rejects invalid times", () => {
    expect(timeToMinutes("11:30")).toBe(690);
    expect(minutesToTime(1320)).toBe("22:00");
    expect(() => timeToMinutes("24:00")).toThrow();
    expect(() => minutesToTime(1440)).toThrow();
  });
});
