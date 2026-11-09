import {
  getDinnerMenu,
  type Weekday,
} from "../data/menu";
import { getRestaurantInfo, type RestaurantInfoTopic } from "../data/restaurant";
import { getHongKongNow, isValidIsoDate, weekdayForDate } from "../lib/time";

export type DailyMenuResult =
  | {
      ok: true;
      date: string;
      weekday: Weekday;
      items: readonly string[];
    }
  | { ok: false; code: "invalid_date"; message: string };

export function restaurantInfo(topic: RestaurantInfoTopic) {
  return {
    ok: true as const,
    topic,
    value: getRestaurantInfo(topic),
  };
}

export function dailyMenu(date?: string): DailyMenuResult {
  const resolvedDate = date ?? getHongKongNow().date;
  if (!isValidIsoDate(resolvedDate)) {
    return {
      ok: false,
      code: "invalid_date",
      message: "Provide a valid calendar date in YYYY-MM-DD format.",
    };
  }

  const weekday = weekdayForDate(resolvedDate) as Weekday;
  return {
    ok: true,
    date: resolvedDate,
    weekday,
    items: getDinnerMenu(weekday),
  };
}
