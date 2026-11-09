import { RESTAURANT } from "../data/restaurant";
import { getHongKongNow, type HongKongNow } from "../lib/time";
import {
  ALTERNATIVE_SEARCH_DAYS,
  BOOKABLE_TIMES,
  isBookableTimeOnDate,
  validateBookingRequest,
  type BookingIssue,
  type ValidatedBookingRequest,
} from "./reservations";

export interface AvailabilityOption {
  date: string;
  time: string;
}

export interface DateSeatUsage {
  [time: string]: number;
}

export interface AvailabilitySearchResult {
  ok: true;
  requested: { date: string; time: string; party_size: number };
  requested_available: boolean;
  alternatives: AvailabilityOption[];
  selected: ValidatedBookingRequest | null;
}

export type AvailabilityFailure = {
  ok: false;
  issue: BookingIssue;
  message: string;
};

export function freeTimesForDate(
  date: string,
  partySize: number,
  seatUsage: DateSeatUsage,
  now: HongKongNow = getHongKongNow(),
): string[] {
  return BOOKABLE_TIMES.filter((time) => {
    if (!isBookableTimeOnDate(date, time, now)) return false;
    const used = seatUsage[time] ?? 0;
    return used + partySize <= RESTAURANT.capacity;
  });
}

export function nearestTimes(
  requestedTime: string,
  freeTimes: readonly string[],
  limit = 3,
): string[] {
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours! * 60 + minutes!;
  };
  const requested = toMinutes(requestedTime);

  return [...freeTimes]
    .sort((left, right) => {
      const distance =
        Math.abs(toMinutes(left) - requested) -
        Math.abs(toMinutes(right) - requested);
      return distance !== 0 ? distance : left.localeCompare(right);
    })
    .slice(0, limit);
}

export async function findAvailability(
  date: string,
  time: string,
  partySize: number,
  loadSeatUsage: (date: string) => Promise<DateSeatUsage>,
  now: HongKongNow = getHongKongNow(),
): Promise<AvailabilitySearchResult | AvailabilityFailure> {
  const validation = validateBookingRequest(date, time, partySize, now);
  if (!validation.ok) {
    return {
      ok: false,
      issue: validation.issue,
      message: validation.message,
    };
  }

  const requested = validation.value;
  const requestedUsage = await loadSeatUsage(requested.date);
  const canFitRequested = requested.slotTimes.every(
    (slot) =>
      (requestedUsage[slot] ?? 0) + requested.partySize <=
      RESTAURANT.capacity,
  );

  if (canFitRequested) {
    return {
      ok: true,
      requested: {
        date: requested.date,
        time: requested.time,
        party_size: requested.partySize,
      },
      requested_available: true,
      alternatives: [],
      selected: requested,
    };
  }

  const sameDateFree = freeTimesForDate(
    requested.date,
    requested.partySize,
    requestedUsage,
    now,
  );

  if (sameDateFree.length > 0) {
    return {
      ok: true,
      requested: {
        date: requested.date,
        time: requested.time,
        party_size: requested.partySize,
      },
      requested_available: false,
      alternatives: nearestTimes(requested.time, sameDateFree).map((value) => ({
        date: requested.date,
        time: value,
      })),
      selected: null,
    };
  }

  const candidateDates = Array.from(
    { length: ALTERNATIVE_SEARCH_DAYS },
    (_, index) => {
      const [year, month, day] = requested.date.split("-").map(Number);
      const candidate = new Date(Date.UTC(year!, month! - 1, day! + index + 1));
      return [
        candidate.getUTCFullYear().toString().padStart(4, "0"),
        (candidate.getUTCMonth() + 1).toString().padStart(2, "0"),
        candidate.getUTCDate().toString().padStart(2, "0"),
      ].join("-");
    },
  );

  for (const candidateDate of candidateDates) {
    if (!isBookableTimeOnDate(candidateDate, BOOKABLE_TIMES[0]!, now)) {
      continue;
    }

    const usage = await loadSeatUsage(candidateDate);
    const free = freeTimesForDate(
      candidateDate,
      requested.partySize,
      usage,
      now,
    );

    if (free.length > 0) {
      return {
        ok: true,
        requested: {
          date: requested.date,
          time: requested.time,
          party_size: requested.partySize,
        },
        requested_available: false,
        alternatives: nearestTimes(requested.time, free).map((value) => ({
          date: candidateDate,
          time: value,
        })),
        selected: null,
      };
    }
  }

  return {
    ok: true,
    requested: {
      date: requested.date,
      time: requested.time,
      party_size: requested.partySize,
    },
    requested_available: false,
    alternatives: [],
    selected: null,
  };
}
