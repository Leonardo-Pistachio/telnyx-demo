import type { BookingInput, BookingResult } from "../../src/actors/DayBookings";
import type { MisunderstandingResult } from "../../src/actors/CallSession";
import type { DateSeatUsage } from "../../src/core/availability";
import { bookedSlotTimes } from "../../src/core/reservations";

export class FakeKv {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; ttl?: number }> = [];

  async get<T>(
    key: string,
    options?: { type?: "json" },
  ): Promise<T | string | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return options?.type === "json" ? (JSON.parse(value) as T) : value;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    this.values.set(key, value);
    this.writes.push({ key, ttl: options?.expirationTtl });
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async list(): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
  }> {
    return {
      keys: [...this.values.keys()].map((name) => ({ name })),
      list_complete: true,
    };
  }
}

class FakeCallSession {
  private count = 0;

  async recordMisunderstanding(): Promise<MisunderstandingResult> {
    if (this.count >= 3) {
      return {
        count: 3,
        shouldEscalate: true,
        newlyReachedThreshold: false,
      };
    }

    this.count += 1;
    return {
      count: this.count,
      shouldEscalate: this.count >= 3,
      newlyReachedThreshold: this.count === 3,
    };
  }

  async misunderstandingCount(): Promise<number> {
    return this.count;
  }
}

class FakeReadinessDayBookings {
  async reservationCount(): Promise<number> {
    return 0;
  }
}

class FakeReadinessCallSession {
  async misunderstandingCount(): Promise<number> {
    return 0;
  }
}

interface StoredReservation {
  reservation_id: string;
  booking_token: string;
  date: string;
  time: string;
  party_size: number;
  name: string;
  phone: string;
  created_at: string;
}

class FakeDayBookings {
  reservations: StoredReservation[] = [];

  private usage(): DateSeatUsage {
    const usage: DateSeatUsage = {};
    for (const reservation of this.reservations) {
      for (const slot of bookedSlotTimes(reservation.time)) {
        usage[slot] = (usage[slot] ?? 0) + reservation.party_size;
      }
    }
    return usage;
  }

  async seatUsage(): Promise<DateSeatUsage> {
    return this.usage();
  }

  async book(input: BookingInput): Promise<BookingResult> {
    const existing = this.reservations.find(
      (reservation) => reservation.booking_token === input.bookingToken,
    );
    if (existing) {
      return {
        ok: true,
        idempotent: true,
        reservation: {
          reservation_id: existing.reservation_id,
          date: existing.date,
          time: existing.time,
          party_size: existing.party_size,
          name: existing.name,
          phone: existing.phone,
          created_at: existing.created_at,
        },
      };
    }

    const usage = this.usage();
    if (
      bookedSlotTimes(input.time).some(
        (slot) => (usage[slot] ?? 0) + input.partySize > 40,
      )
    ) {
      return { ok: false, reason: "slot_taken" };
    }

    const reservation: StoredReservation = {
      reservation_id: `res_${crypto.randomUUID()}`,
      booking_token: input.bookingToken,
      date: input.date,
      time: input.time,
      party_size: input.partySize,
      name: input.name,
      phone: input.phone,
      created_at: new Date().toISOString(),
    };
    this.reservations.push(reservation);

    return {
      ok: true,
      idempotent: false,
      reservation: {
        reservation_id: reservation.reservation_id,
        date: reservation.date,
        time: reservation.time,
        party_size: reservation.party_size,
        name: reservation.name,
        phone: reservation.phone,
        created_at: reservation.created_at,
      },
    };
  }
}

export function createFakeEnvironment() {
  const kv = new FakeKv();
  const dayBookings = new Map<string, FakeDayBookings>();
  const callSessions = new Map<string, FakeCallSession>();

  const env = {
    CAFE_KV: kv,
    DAY_BOOKINGS: {
      idFromName(name: string) {
        if (name === "2000-01-01") {
          return new FakeReadinessDayBookings();
        }
        if (!dayBookings.has(name)) {
          dayBookings.set(name, new FakeDayBookings());
        }
        return dayBookings.get(name)!;
      },
    },
    CALL_SESSION: {
      idFromName(name: string) {
        if (name === "readiness") {
          return new FakeReadinessCallSession();
        }
        if (!callSessions.has(name)) {
          callSessions.set(name, new FakeCallSession());
        }
        return callSessions.get(name)!;
      },
    },
  };

  return { env: env as never, kv, dayBookings, callSessions };
}
