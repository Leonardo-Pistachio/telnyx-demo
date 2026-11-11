import type { PublicReservation } from "../actors/DayBookings";
import type { AppBindings } from "../env";
import { isValidIsoDate } from "../lib/time";
import { maskPhone } from "../lib/logger";
import { normalizePhone } from "./contact";

export type LookupFailure = {
  ok: false;
  code: "invalid_arguments" | "not_found" | "store_unavailable";
  message: string;
};

export type VerifiedLookup =
  | { ok: true; reservation: PublicReservation }
  | LookupFailure;

export type PublicLookup =
  | { ok: true; reservation: ReturnType<typeof redactReservation> }
  | LookupFailure;

// Deliberately identical for every mismatch so the tool can never reveal which
// factor was wrong (or whether a booking exists at all).
export const LOOKUP_NOT_FOUND: LookupFailure = {
  ok: false,
  code: "not_found",
  message:
    "No reservation matches that name, phone number, and date.",
};

function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Relaxed match: a caller may give only their surname ("Chan") or the full name
// ("Chan Tai Man"). Tokens are compared as sets, never as raw substrings.
export function namesMatch(provided: string, booked: string): boolean {
  const providedTokens = nameTokens(provided);
  const bookedTokens = nameTokens(booked);

  if (providedTokens.length === 0 || bookedTokens.length === 0) return false;
  if (providedTokens.join("").length < 2 || bookedTokens.join("").length < 2) {
    return false;
  }

  const providedInBooked = providedTokens.every((token) =>
    bookedTokens.includes(token),
  );
  const bookedInProvided = bookedTokens.every((token) =>
    providedTokens.includes(token),
  );

  return providedInBooked || bookedInProvided;
}

export async function findVerifiedReservation(
  env: AppBindings,
  name: string,
  phone: string,
  date: string,
): Promise<VerifiedLookup> {
  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    !isValidIsoDate(date)
  ) {
    return {
      ok: false,
      code: "invalid_arguments",
      message:
        "Provide the guest name, phone number, and booking date to look up a reservation.",
    };
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return {
      ok: false,
      code: "invalid_arguments",
      message: "Provide the phone number used for the booking.",
    };
  }

  try {
    const bookings = env.DAY_BOOKINGS.idFromName(date);
    const rows = await bookings.findByPhone(normalizedPhone);
    const match = rows.find((row) => namesMatch(name, row.name));

    if (!match) return LOOKUP_NOT_FOUND;

    return { ok: true, reservation: match };
  } catch {
    return {
      ok: false,
      code: "store_unavailable",
      message:
        "I could not check the reservation right now. Please try again or ask for a callback.",
    };
  }
}

function redactReservation(reservation: PublicReservation) {
  return {
    reservation_id: reservation.reservation_id,
    date: reservation.date,
    time: reservation.time,
    party_size: reservation.party_size,
    name: reservation.name,
    phone: maskPhone(reservation.phone),
    seating: reservation.seating,
    remark: reservation.remark,
    created_at: reservation.created_at,
  };
}

export async function lookupReservation(
  env: AppBindings,
  name: string,
  phone: string,
  date: string,
): Promise<PublicLookup> {
  const verified = await findVerifiedReservation(env, name, phone, date);
  if (!verified.ok) return verified;

  return {
    ok: true,
    reservation: redactReservation(verified.reservation),
  };
}
