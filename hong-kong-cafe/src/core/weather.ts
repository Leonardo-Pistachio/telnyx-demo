import { isValidIsoDate, weekdayForDate } from "../lib/time";

export type WeatherCondition = "sunny" | "rainy";

export interface WeatherResult {
  date: string;
  weekday: string;
  condition: WeatherCondition;
  outdoor_open: boolean;
  message: string;
}

const RAINY_WEEKDAYS = new Set(["Saturday", "Sunday"]);

// Demo forecast: deterministic by the booking date's weekday so the phone flow
// always has a realistic answer. Outdoor seating is closed on weekends when it
// "rains" and open on sunny weekdays.
export function getWeather(date: string): WeatherResult {
  if (!isValidIsoDate(date)) {
    throw new Error("Invalid calendar date");
  }

  const weekday = weekdayForDate(date);
  const rainy = RAINY_WEEKDAYS.has(weekday);

  return {
    date,
    weekday,
    condition: rainy ? "rainy" : "sunny",
    outdoor_open: !rainy,
    message: rainy
      ? `Rain is expected in Hong Kong on ${weekday} ${date}. The outdoor seating area is not open today; indoor seating is available.`
      : `The weather in Hong Kong on ${weekday} ${date} is sunny, so the outdoor seating area is open.`,
  };
}
