import {
  StatefulActor,
  type SqlValue,
} from "@telnyx/edge-runtime";
import { RESTAURANT } from "../data/restaurant";
import type { DateSeatUsage } from "../core/availability";
import { bookedSlotTimes } from "../core/reservations";

interface ReservationRow extends Record<string, SqlValue> {
  reservation_id: string;
  booking_token: string;
  date: string;
  start_time: string;
  party_size: number;
  guest_name: string;
  phone: string;
  created_at: string;
}

export interface BookingInput {
  bookingToken: string;
  date: string;
  time: string;
  partySize: number;
  name: string;
  phone: string;
}

export interface PublicReservation {
  reservation_id: string;
  date: string;
  time: string;
  party_size: number;
  name: string;
  phone: string;
  created_at: string;
}

export type BookingResult =
  | {
      ok: true;
      reservation: PublicReservation;
      idempotent: boolean;
    }
  | { ok: false; reason: "slot_taken" };

export class DayBookings extends StatefulActor {
  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS reservations (
        reservation_id TEXT PRIMARY KEY,
        booking_token TEXT NOT NULL UNIQUE,
        date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        party_size INTEGER NOT NULL,
        guest_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS reservations_booking_token
      ON reservations (booking_token)
    `);
  }

  private currentUsage(): DateSeatUsage {
    const rows = this.ctx.storage.sql
      .exec<{ start_time: string; party_size: number }>(
        "SELECT start_time, party_size FROM reservations",
      )
      .toArray();

    const usage: DateSeatUsage = {};
    for (const row of rows) {
      for (const slot of bookedSlotTimes(row.start_time)) {
        usage[slot] = (usage[slot] ?? 0) + row.party_size;
      }
    }
    return usage;
  }

  private publicReservation(row: ReservationRow): PublicReservation {
    return {
      reservation_id: row.reservation_id,
      date: row.date,
      time: row.start_time,
      party_size: row.party_size,
      name: row.guest_name,
      phone: row.phone,
      created_at: row.created_at,
    };
  }

  async seatUsage(): Promise<DateSeatUsage> {
    this.ensureSchema();
    return this.currentUsage();
  }

  async book(input: BookingInput): Promise<BookingResult> {
    this.ensureSchema();

    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<ReservationRow>(
          "SELECT * FROM reservations WHERE booking_token = ?",
          input.bookingToken,
        )
        .toArray()[0];

      if (existing) {
        return {
          ok: true,
          reservation: this.publicReservation(existing),
          idempotent: true,
        };
      }

      const usage = this.currentUsage();
      const requiredSlots = bookedSlotTimes(input.time);

      for (const slot of requiredSlots) {
        if (
          (usage[slot] ?? 0) + input.partySize >
          RESTAURANT.capacity
        ) {
          return { ok: false, reason: "slot_taken" } as const;
        }
      }

      const reservation: ReservationRow = {
        reservation_id: `res_${crypto.randomUUID()}`,
        booking_token: input.bookingToken,
        date: input.date,
        start_time: input.time,
        party_size: input.partySize,
        guest_name: input.name,
        phone: input.phone,
        created_at: new Date().toISOString(),
      };

      this.ctx.storage.sql.exec(
        `INSERT INTO reservations
          (reservation_id, booking_token, date, start_time, party_size, guest_name, phone, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        reservation.reservation_id,
        reservation.booking_token,
        reservation.date,
        reservation.start_time,
        reservation.party_size,
        reservation.guest_name,
        reservation.phone,
        reservation.created_at,
      );

      return {
        ok: true,
        reservation: this.publicReservation(reservation),
        idempotent: false,
      } as const;
    });
  }

  async reservationCount(): Promise<number> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql
      .exec<{ total: number }>("SELECT COUNT(*) AS total FROM reservations")
      .toArray();

    return rows[0]?.total ?? 0;
  }
}
