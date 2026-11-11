import { describe, expect, it } from "vitest";
import {
  findVerifiedReservation,
  lookupReservation,
  namesMatch,
} from "../src/core/lookup-service";
import { createFakeEnvironment } from "./support/fake-env";

const DATE = "2026-11-20";
const PHONE = "+852 9123 4567";
const STORED_PHONE = "+85291234567";

async function seed(fake: ReturnType<typeof createFakeEnvironment>) {
  const actor = (fake.env as unknown as {
    DAY_BOOKINGS: {
      idFromName(name: string): {
        book(input: Record<string, unknown>): Promise<unknown>;
      };
    };
  }).DAY_BOOKINGS.idFromName(DATE);

  await actor.book({
    bookingToken: "sel_seed",
    date: DATE,
    time: "18:00",
    partySize: 4,
    name: "Ada Chan",
    phone: STORED_PHONE,
    seating: "outside",
    remark: "Birthday",
  });
}

describe("relaxed name matching", () => {
  it("accepts a surname or a reordered full name", () => {
    expect(namesMatch("Chan", "Ada Chan")).toBe(true);
    expect(namesMatch("ada chan", "Ada Chan")).toBe(true);
    expect(namesMatch("Chan, Ada", "Ada Chan")).toBe(true);
  });

  it("rejects unrelated names and too-short fragments", () => {
    expect(namesMatch("Lee", "Ada Chan")).toBe(false);
    expect(namesMatch("A", "Ada Chan")).toBe(false);
    expect(namesMatch("Chan Tai Man", "Ada Chan")).toBe(false);
  });
});

describe("booking lookup guardrail", () => {
  it("returns details only when name, phone, and date all match", async () => {
    const fake = createFakeEnvironment();
    await seed(fake);

    const result = await lookupReservation(fake.env, "Chan", PHONE, DATE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reservation.name).toBe("Ada Chan");
    expect(result.reservation.phone).toBe("***4567");
    expect(result.reservation.remark).toBe("Birthday");
    expect(result.reservation.seating).toBe("outside");
  });

  it("returns the same not_found result for each wrong factor", async () => {
    const fake = createFakeEnvironment();
    await seed(fake);

    const wrongName = await findVerifiedReservation(
      fake.env,
      "Lee",
      PHONE,
      DATE,
    );
    const wrongPhone = await findVerifiedReservation(
      fake.env,
      "Chan",
      "+852 9000 0000",
      DATE,
    );
    const wrongDate = await findVerifiedReservation(
      fake.env,
      "Chan",
      PHONE,
      "2026-11-21",
    );

    const identical = {
      ok: false,
      code: "not_found",
      message: expect.any(String),
    };

    expect(wrongName).toMatchObject(identical);
    expect(wrongPhone).toMatchObject(identical);
    expect(wrongDate).toMatchObject(identical);
    expect(wrongName).toEqual(wrongPhone);
    expect(wrongPhone).toEqual(wrongDate);
  });

  it("rejects malformed lookup arguments", async () => {
    const fake = createFakeEnvironment();

    await expect(
      findVerifiedReservation(fake.env, "", PHONE, DATE),
    ).resolves.toMatchObject({ ok: false, code: "invalid_arguments" });
    await expect(
      findVerifiedReservation(fake.env, "Chan", "not-a-phone", DATE),
    ).resolves.toMatchObject({ ok: false, code: "invalid_arguments" });
    await expect(
      findVerifiedReservation(fake.env, "Chan", PHONE, "20-11-2026"),
    ).resolves.toMatchObject({ ok: false, code: "invalid_arguments" });
  });
});
