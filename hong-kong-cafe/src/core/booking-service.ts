import type { AppBindings } from "../env";
import { getHongKongNow, type HongKongNow } from "../lib/time";
import { findAvailability } from "./availability";
import { normalizeContact } from "./contact";
import { validateBookingRequest } from "./reservations";
import { readSelection } from "./tokens";
import { loadSeatUsage } from "./availability-service";

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
      };
    }
  | {
      ok: false;
      code:
        | "selection_expired"
        | "invalid_name"
        | "invalid_phone"
        | "slot_taken"
        | "store_unavailable";
      message: string;
      alternatives?: Array<{ date: string; time: string }>;
    };

export async function createReservation(
  env: AppBindings,
  selectionToken: string,
  name: string,
  phone: string,
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

    const bookings = env.DAY_BOOKINGS.idFromName(validation.value.date);
    const result = await bookings.book({
      bookingToken: selectionToken,
      date: validation.value.date,
      time: validation.value.time,
      partySize: validation.value.partySize,
      name: contact.value.name!,
      phone: contact.value.phone,
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

    return {
      ok: true,
      status: result.idempotent ? "already_confirmed" : "confirmed",
      reservation: {
        reservation_id: result.reservation.reservation_id,
        date: result.reservation.date,
        time: result.reservation.time,
        party_size: result.reservation.party_size,
        name: result.reservation.name,
      },
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
