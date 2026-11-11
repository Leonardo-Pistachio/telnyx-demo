import { RESTAURANT } from "../data/restaurant";
import {
  addDays,
  compareIsoDates,
  getHongKongNow,
  isValidIsoDate,
  isTime,
  minutesToTime,
  timeToMinutes,
  type HongKongNow,
} from "../lib/time";

export const SLOT_MINUTES = 30;
export const RESERVATION_DURATION_MINUTES = 60;
export const MAX_PARTY_SIZE = 10;
export const BOOKING_WINDOW_DAYS = 30;
export const ALTERNATIVE_SEARCH_DAYS = 7;

const OPENING_MINUTES = timeToMinutes(RESTAURANT.openingTime);
const CLOSING_MINUTES = timeToMinutes(RESTAURANT.closingTime);
const LAST_RESERVATION_MINUTES = timeToMinutes(
  RESTAURANT.lastReservationTime,
);

export const BOOKABLE_TIMES: readonly string[] = Array.from(
  {
    length:
      (LAST_RESERVATION_MINUTES - OPENING_MINUTES) / SLOT_MINUTES + 1,
  },
  (_, index) => minutesToTime(OPENING_MINUTES + index * SLOT_MINUTES),
);

export type BookingIssue =
  | "invalid_date"
  | "outside_window"
  | "invalid_time"
  | "past_time"
  | "invalid_party_size"
  | "party_too_large";

export interface ValidatedBookingRequest {
  date: string;
  time: string;
  partySize: number;
  slotTimes: string[];
}

export type BookingValidation =
  | { ok: true; value: ValidatedBookingRequest }
  | { ok: false; issue: BookingIssue; message: string };

export function bookedSlotTimes(startTime: string): string[] {
  if (!isTime(startTime)) {
    throw new Error("Invalid start time");
  }

  const start = timeToMinutes(startTime);
  const result: string[] = [];

  for (
    let offset = 0;
    offset < RESERVATION_DURATION_MINUTES;
    offset += SLOT_MINUTES
  ) {
    const slot = start + offset;
    if (slot >= CLOSING_MINUTES) {
      throw new Error("Reservation exceeds closing time");
    }
    result.push(minutesToTime(slot));
  }

  return result;
}

export function validateBookingRequest(
  date: string,
  time: string,
  partySize: number,
  now: HongKongNow = getHongKongNow(),
): BookingValidation {
  if (!isValidIsoDate(date)) {
    return {
      ok: false,
      issue: "invalid_date",
      message: "Please provide a valid calendar date.",
    };
  }

  if (!Number.isInteger(partySize)) {
    return {
      ok: false,
      issue: "invalid_party_size",
      message: "Party size must be a whole number.",
    };
  }

  if (partySize < 1) {
    return {
      ok: false,
      issue: "invalid_party_size",
      message: "Party size must be at least one.",
    };
  }

  if (partySize > MAX_PARTY_SIZE) {
    return {
      ok: false,
      issue: "party_too_large",
      message:
        "Parties larger than ten need a callback so the restaurant can arrange them.",
    };
  }

  const earliestDate = now.date;
  const latestDate = addDays(now.date, BOOKING_WINDOW_DAYS);

  if (compareIsoDates(date, earliestDate) < 0) {
    return {
      ok: false,
      issue: "outside_window",
      message: "That date is in the past.",
    };
  }

  if (compareIsoDates(date, latestDate) > 0) {
    return {
      ok: false,
      issue: "outside_window",
      message: `Bookings are available up to ${BOOKING_WINDOW_DAYS} days ahead.`,
    };
  }

  if (!isTime(time) || !BOOKABLE_TIMES.includes(time)) {
    return {
      ok: false,
      issue: "invalid_time",
      message: `Reservations start every 30 minutes from ${RESTAURANT.openingTime} through ${RESTAURANT.lastReservationTime}.`,
    };
  }

  if (date === now.date && timeToMinutes(time) <= now.minutes) {
    return {
      ok: false,
      issue: "past_time",
      message: "That time has already passed. Please choose a later time.",
    };
  }

  return {
    ok: true,
    value: {
      date,
      time,
      partySize,
      slotTimes: bookedSlotTimes(time),
    },
  };
}

export function isBookableTimeOnDate(
  date: string,
  time: string,
  now: HongKongNow = getHongKongNow(),
): boolean {
  if (!isValidIsoDate(date) || !BOOKABLE_TIMES.includes(time)) return false;
  if (date === now.date && timeToMinutes(time) <= now.minutes) return false;

  const latestDate = addDays(now.date, BOOKING_WINDOW_DAYS);
  return (
    compareIsoDates(date, now.date) >= 0 &&
    compareIsoDates(date, latestDate) <= 0
  );
}
