import type {
  PublicReservation,
  SeatingPreference,
} from "../actors/DayBookings";
import type { AppBindings } from "../env";
import { getHongKongNow, type HongKongNow } from "../lib/time";
import { findAvailability } from "./availability";
import { normalizeContact } from "./contact";
import { sendBookingEmail } from "./email-service";
import { validateBookingRequest } from "./reservations";
import { readSelection } from "./tokens";
import { loadSeatUsage } from "./availability-service";
import { getWeather } from "./weather";

export const MAX_REMARK_LENGTH = 200;

export interface CreateReservationOptions {
  seating?: SeatingPreference;
  remark?: string;
}

export type CreateReservationResult =
  | {
      ok: true;
      status: "confirmed" | "already_confirmed";
      reservation: {
        reservation_id: string;
        date: string;
        time: string;
        party_size: number;
        name: string;
        seating: SeatingPreference;
        remark: string;
      };
    }
  | {
      ok: false;
      code:
        | "selection_expired"
        | "invalid_name"
        | "invalid_phone"
        | "invalid_remark"
        | "outdoor_unavailable"
        | "slot_taken"
        | "store_unavailable";
      message: string;
      alternatives?: Array<{ date: string; time: string }>;
    };

function normalizeRemark(value: string | undefined): string | null {
  if (value === undefined) return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length > MAX_REMARK_LENGTH) return null;
  return trimmed;
}

function publicReservation(reservation: PublicReservation) {
  return {
    reservation_id: reservation.reservation_id,
    date: reservation.date,
    time: reservation.time,
    party_size: reservation.party_size,
    name: reservation.name,
    seating: reservation.seating,
    remark: reservation.remark,
  };
}

export async function createReservation(
  env: AppBindings,
  selectionToken: string,
  name: string,
  phone: string,
  options: CreateReservationOptions = {},
  now: HongKongNow = getHongKongNow(),
): Promise<CreateReservationResult> {
  try {
    const selection = await readSelection(env.CAFE_KV, selectionToken);
    if (!selection) {
      return {
        ok: false,
        code: "selection_expired",
        message:
          "That availability choice has expired. Please check the time again.",
      };
    }

    const validation = validateBookingRequest(
      selection.date,
      selection.time,
      selection.party_size,
      now,
    );
    if (!validation.ok) {
      return {
        ok: false,
        code: "selection_expired",
        message: validation.message,
      };
    }

    const contact = normalizeContact(name, phone, true);
    if (!contact.ok) {
      return {
        ok: false,
        code: contact.code,
        message: contact.message,
      };
    }

    const remark = normalizeRemark(options.remark);
    if (remark === null) {
      return {
        ok: false,
        code: "invalid_remark",
        message: `Please keep the special-occasion note under ${MAX_REMARK_LENGTH} characters.`,
      };
    }

    const seating: SeatingPreference =
      options.seating === "outside" ? "outside" : "inside";

    if (seating === "outside") {
      const weather = getWeather(validation.value.date);
      if (!weather.outdoor_open) {
        return {
          ok: false,
          code: "outdoor_unavailable",
          message: `${weather.message} Would you like indoor seating instead?`,
        };
      }
    }

    const bookings = env.DAY_BOOKINGS.idFromName(validation.value.date);
    const result = await bookings.book({
      bookingToken: selectionToken,
      date: validation.value.date,
      time: validation.value.time,
      partySize: validation.value.partySize,
      name: contact.value.name!,
      phone: contact.value.phone,
      seating,
      remark,
    });

    if (!result.ok) {
      const alternatives = await findAvailability(
        validation.value.date,
        validation.value.time,
        validation.value.partySize,
        (candidate) => loadSeatUsage(env, candidate),
        now,
      );

      return {
        ok: false,
        code: "slot_taken",
        message:
          "That time was just taken. I can offer another available time.",
        alternatives:
          alternatives.ok && !alternatives.requested_available
            ? alternatives.alternatives
            : [],
      };
    }

    const reservation = publicReservation(result.reservation);

    if (result.idempotent) {
      return {
        ok: true,
        status: "already_confirmed",
        reservation,
      };
    }

    // Internal notification only: its outcome is logged, never returned to the
    // Assistant, so the agent cannot claim an email was sent to the caller.
    await sendBookingEmail({
      ...reservation,
      phone: result.reservation.phone,
      created_at: result.reservation.created_at,
    });

    return {
      ok: true,
      status: "confirmed",
      reservation,
    };
  } catch {
    return {
      ok: false,
      code: "store_unavailable",
      message:
        "I could not confirm the reservation right now. I will not claim it was booked. Please try the same confirmation once more or ask for a callback.",
    };
  }
}
