import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildBookingEmail,
  buildCallbackEmail,
  sendBookingEmail,
  sendCallbackEmail,
  type BookingEmailDetails,
} from "../src/core/email-service";

const DETAILS: BookingEmailDetails = {
  reservation_id: "res_test",
  date: "2026-11-20",
  time: "18:00",
  party_size: 4,
  name: "Ada Chan",
  phone: "+85291234567",
  seating: "outside",
  remark: "Birthday dinner",
  created_at: "2026-11-11T00:00:00.000Z",
};

const ORIGINAL_ENV = {
  EMAIL_API_KEY: process.env.EMAIL_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  BOOKING_NOTIFICATION_EMAIL: process.env.BOOKING_NOTIFICATION_EMAIL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("booking notification email", () => {
  beforeEach(() => {
    delete process.env.EMAIL_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.BOOKING_NOTIFICATION_EMAIL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv();
  });

  it("builds a one-hour summary with seating and remark", () => {
    const { subject, text } = buildBookingEmail(DETAILS);

    expect(subject).toContain("res_test");
    expect(subject).toContain("2026-11-20 18:00");
    expect(text).toContain("18:00–19:00 (1 hour)");
    expect(text).toContain("Ada Chan");
    expect(text).toContain("Seating: outside");
    expect(text).toContain("Special occasion: Birthday dinner");
  });

  it("skips quietly when the email secrets are missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendBookingEmail(DETAILS);

    expect(result).toEqual({ sent: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the summary to Resend and reports success", async () => {
    process.env.EMAIL_API_KEY = "re_test";
    process.env.EMAIL_FROM = "cafe@example.com";
    process.env.BOOKING_NOTIFICATION_EMAIL = "imt183404@gmail.com";

    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendBookingEmail(DETAILS);

    expect(result).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body)) as {
      from: string;
      to: string[];
      subject: string;
      text: string;
    };
    expect(body.from).toBe("cafe@example.com");
    expect(body.to).toEqual(["imt183404@gmail.com"]);
    expect(body.text).toContain("Ada Chan");
  });

  it("does not throw when the provider rejects the email", async () => {
    process.env.EMAIL_API_KEY = "re_test";
    process.env.BOOKING_NOTIFICATION_EMAIL = "imt183404@gmail.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );

    const result = await sendBookingEmail(DETAILS);

    expect(result).toEqual({ sent: false, reason: "send_failed" });
  });

  it("builds and sends a callback summary", async () => {
    process.env.EMAIL_API_KEY = "re_test";
    process.env.BOOKING_NOTIFICATION_EMAIL = "jackchan12382@gmail.com";

    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "email_2" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const details = {
      callback_id: "cb_1",
      name: "Sam Lee",
      phone: "+85291234567",
      created_at: "2026-11-11T13:00:00.000Z",
    };
    const { subject, text } = buildCallbackEmail(details);
    expect(subject).toContain("Callback request");
    expect(subject).toContain("Sam Lee");
    expect(text).toContain("+85291234567");
    expect(text).toContain("cb_1");

    const result = await sendCallbackEmail(details);
    expect(result).toEqual({ sent: true });

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as {
      to: string[];
      text: string;
    };
    expect(body.to).toEqual(["jackchan12382@gmail.com"]);
    expect(body.text).toContain("Sam Lee");
  });
});
