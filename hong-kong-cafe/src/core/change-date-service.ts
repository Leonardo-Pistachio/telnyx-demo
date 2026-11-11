import type { PublicReservation } from "../actors/DayBookings";
import type { AppBindings } from "../env";
import { getHongKongNow, isValidIsoDate, type HongKongNow } from "../lib/time";
import { findAvailability } from "./availability";
import { loadSeatUsage } from "./availability-service";
import { findVerifiedReservation } from "./lookup-service";
import { isBookableTimeOnDate } from "./reservations";

export type ChangeReservationResult =
  | { ok: true; status: "moved"; reservation: PublicReservation }
  | {
      ok: false;
      code:
        | "invalid_arguments"
        | "not_found"
        | "invalid_date"
        | "outside_window"
        | "same_date"
        | "slot_taken"
        | "store_unavailable";
      message: string;
      alternatives?: Array<{ date: string; time: string }>;
    };

export async function changeReservationDate(
  env: AppBindings,
  name: string,
  phone: string,
  currentDate: string,
  newDate: string,
  now: HongKongNow = getHongKongNow(),
): Promise<ChangeReservationResult> {
  if (!isValidIsoDate(newDate)) {
    return {
      ok: false,
      code: "invalid_date",
      message: "Please provide a valid new calendar date.",
    };
  }

  const verified = await findVerifiedReservation(
    env,
    name,
    phone,
    currentDate,
  );
  if (!verified.ok) return verified;

  const reservation = verified.reservation;

  if (newDate === currentDate) {
    return {
      ok: false,
      code: "same_date",
      message:
        "The booking is already on that date. Please choose a different date.",
    };
  }

  if (!isBookableTimeOnDate(newDate, reservation.time, now)) {
    return {
      ok: false,
      code: "outside_window",
      message: `The booking can only move to a date within the booking window where ${reservation.time} is still bookable.`,
    };
  }

  try {
    const target = env.DAY_BOOKINGS.idFromName(newDate);
    const moved = await target.book({
      bookingToken: `move_${crypto.randomUUID()}`,
      reservationId: reservation.reservation_id,
      date: newDate,
      time: reservation.time,
      partySize: reservation.party_size,
      name: reservation.name,
      phone: reservation.phone,
      seating: reservation.seating,
      remark: reservation.remark,
    });

    if (!moved.ok) {
      const availability = await findAvailability(
        newDate,
        reservation.time,
        reservation.party_size,
        (candidate) => loadSeatUsage(env, candidate),
        now,
      );

      return {
        ok: false,
        code: "slot_taken",
        message:
          "That date is full at the original time. I can offer another time on that date.",
        alternatives: availability.ok ? availability.alternatives : [],
      };
    }

    const source = env.DAY_BOOKINGS.idFromName(currentDate);
    let removed: PublicReservation | null = null;
    try {
      removed = await source.remove(reservation.reservation_id);
    } catch {
      removed = null;
    }

    if (!removed) {
      try {
        await target.remove(reservation.reservation_id);
      } catch {
        // Best-effort compensation; the structured error below reports it.
      }

      return {
        ok: false,
        code: "store_unavailable",
        message:
          "I could not move the booking safely, so it stays on the original date. Please try again or ask for a callback.",
      };
    }

    return { ok: true, status: "moved", reservation: moved.reservation };
  } catch {
    return {
      ok: false,
      code: "store_unavailable",
      message:
        "I could not move the booking right now. The original reservation is unchanged. Please try again or ask for a callback.",
    };
  }
}
