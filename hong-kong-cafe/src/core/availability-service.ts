import type { AppBindings } from "../env";
import type { HongKongNow } from "../lib/time";
import {
  findAvailability,
  type AvailabilityFailure,
  type AvailabilitySearchResult,
  type DateSeatUsage,
} from "./availability";
import { saveSelection } from "./tokens";

export type CheckAvailabilityResult =
  | (AvailabilitySearchResult & { selection_token?: string })
  | AvailabilityFailure
  | {
      ok: false;
      issue: "store_unavailable";
      message: string;
    };

export async function loadSeatUsage(
  env: AppBindings,
  date: string,
): Promise<DateSeatUsage> {
  const bookings = env.DAY_BOOKINGS.idFromName(date);
  return bookings.seatUsage();
}

export async function checkAvailability(
  env: AppBindings,
  date: string,
  time: string,
  partySize: number,
  now?: HongKongNow,
): Promise<CheckAvailabilityResult> {
  try {
    const result = await findAvailability(
      date,
      time,
      partySize,
      (candidate) => loadSeatUsage(env, candidate),
      now,
    );

    if (!result.ok || !result.selected) return result;

    const selectionToken = await saveSelection(env.CAFE_KV, {
      date: result.selected.date,
      time: result.selected.time,
      party_size: result.selected.partySize,
      created_at: new Date().toISOString(),
    });

    return { ...result, selection_token: selectionToken };
  } catch {
    return {
      ok: false,
      issue: "store_unavailable",
      message: "I could not check availability right now. Please try again.",
    };
  }
}
