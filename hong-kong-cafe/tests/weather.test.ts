import { describe, expect, it } from "vitest";
import { getWeather } from "../src/core/weather";

describe("demo weather", () => {
  it("closes outdoor seating and reports rain on weekends", () => {
    for (const date of ["2026-11-14", "2026-11-15", "2026-11-21"]) {
      const weather = getWeather(date);
      expect(weather.condition).toBe("rainy");
      expect(weather.outdoor_open).toBe(false);
      expect(weather.message).toMatch(/not open/i);
    }
  });

  it("keeps outdoor seating open on weekdays", () => {
    for (const date of ["2026-11-11", "2026-11-13", "2026-11-16"]) {
      const weather = getWeather(date);
      expect(weather.condition).toBe("sunny");
      expect(weather.outdoor_open).toBe(true);
    }
  });

  it("rejects an invalid date", () => {
    expect(() => getWeather("2026-13-01")).toThrow();
  });
});
