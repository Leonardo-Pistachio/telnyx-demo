import { describe, expect, it } from "vitest";
import { changeReservationDate } from "../src/core/change-date-service";
import { getHongKongNow } from "../src/lib/time";
import { createFakeEnvironment } from "./support/fake-env";

const NOW = getHongKongNow(new Date("2026-11-09T02:00:00.000Z"));
const CURRENT_DATE = "2026-11-10";
const NEW_DATE = "2026-11-11";
const STORED_PHONE = "+85291234567";

type FakeEnv = ReturnType<typeof createFakeEnvironment>;

function actorFor(fake: FakeEnv, date: string) {
  return (
    fake.env as unknown as {
      DAY_BOOKINGS: {
        idFromName(name: string): {
          reservations: Array<Record<string, unknown>>;
          book(input: Record<string, unknown>): Promise<unknown>;
        };
      };
    }
  ).DAY_BOOKINGS.idFromName(date);
}

async function seed(
  fake: FakeEnv,
  overrides: Record<string, unknown> = {},
) {
  await actorFor(fake, CURRENT_DATE).book({
    bookingToken: "sel_seed",
    date: CURRENT_DATE,
    time: "18:00",
    partySize: 4,
    name: "Ada Chan",
    phone: STORED_PHONE,
    seating: "inside",
    remark: "Birthday",
    ...overrides,
  });
}

describe("changing a booking date", () => {
  it("moves the booking to another date, keeping time and details", async () => {
    const fake = createFakeEnvironment();
    await seed(fake);

    const result = await changeReservationDate(
      fake.env,
      "Chan",
      "+852 9123 4567",
      CURRENT_DATE,
      NEW_DATE,
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reservation.date).toBe(NEW_DATE);
    expect(result.reservation.time).toBe("18:00");
    expect(result.reservation.party_size).toBe(4);
    expect(result.reservation.remark).toBe("Birthday");

    expect(actorFor(fake, CURRENT_DATE).reservations).toHaveLength(0);
    const moved = actorFor(fake, NEW_DATE).reservations;
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      date: NEW_DATE,
      time: "18:00",
      party_size: 4,
      name: "Ada Chan",
    });
  });

  it("refuses to move when the identity factors do not match", async () => {
    const fake = createFakeEnvironment();
    await seed(fake);

    const result = await changeReservationDate(
      fake.env,
      "Chan",
      "+852 9000 0000",
      CURRENT_DATE,
      NEW_DATE,
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(actorFor(fake, CURRENT_DATE).reservations).toHaveLength(1);
    expect(actorFor(fake, NEW_DATE).reservations).toHaveLength(0);
  });

  it("rejects the same date and dates outside the booking window", async () => {
    const fake = createFakeEnvironment();
    await seed(fake);

    await expect(
      changeReservationDate(
        fake.env,
        "Chan",
        STORED_PHONE,
        CURRENT_DATE,
        CURRENT_DATE,
        NOW,
      ),
    ).resolves.toMatchObject({ ok: false, code: "same_date" });

    await expect(
      changeReservationDate(
        fake.env,
        "Chan",
        STORED_PHONE,
        CURRENT_DATE,
        "2027-01-30",
        NOW,
      ),
    ).resolves.toMatchObject({ ok: false, code: "outside_window" });
  });

  it("keeps the original booking when the new date is full", async () => {
    const fake = createFakeEnvironment();
    await seed(fake);
    await actorFor(fake, NEW_DATE).book({
      bookingToken: "sel_fill",
      date: NEW_DATE,
      time: "18:00",
      partySize: 40,
      name: "Other Guest",
      phone: "+85298887777",
    });

    const result = await changeReservationDate(
      fake.env,
      "Chan",
      STORED_PHONE,
      CURRENT_DATE,
      NEW_DATE,
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "slot_taken" });
    if (result.ok) return;
    expect(result.alternatives?.length).toBeGreaterThan(0);

    expect(actorFor(fake, CURRENT_DATE).reservations).toHaveLength(1);
    expect(actorFor(fake, NEW_DATE).reservations).toHaveLength(1);
  });
});
