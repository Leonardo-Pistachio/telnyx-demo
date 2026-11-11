import type { SeatingPreference } from "../actors/DayBookings";
import { RESERVATION_DURATION_MINUTES } from "./reservations";
import { logEvent } from "../lib/logger";
import { getRuntimeSecret } from "../lib/secrets";
import { minutesToTime, timeToMinutes } from "../lib/time";
import { RESTAURANT } from "../data/restaurant";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Hong Kong Cafe <onboarding@resend.dev>";
const SEND_TIMEOUT_MS = 5000;

export interface BookingEmailDetails {
  reservation_id: string;
  date: string;
  time: string;
  party_size: number;
  name: string;
  phone: string;
  seating: SeatingPreference;
  remark: string;
  created_at?: string;
}

export interface CallbackEmailDetails {
  callback_id: string;
  name?: string;
  phone: string;
  created_at?: string;
}

export interface EmailResult {
  sent: boolean;
  reason?: "not_configured" | "send_failed";
}

interface EmailEvents {
  route: string;
  skipped: string;
  sent: string;
  failed: string;
  resultId: string;
}

function bookingEndTime(startTime: string): string {
  return minutesToTime(timeToMinutes(startTime) + RESERVATION_DURATION_MINUTES);
}

export function buildBookingEmail(details: BookingEmailDetails): {
  subject: string;
  text: string;
} {
  const subject = `New reservation ${details.reservation_id} — ${details.date} ${details.time}`;
  const lines = [
    "A new reservation has been confirmed at Hong Kong Cafe.",
    "",
    `Reservation ID: ${details.reservation_id}`,
    `Date: ${details.date}`,
    `Time: ${details.time}–${bookingEndTime(details.time)} (1 hour)`,
    `Party size: ${details.party_size}`,
    `Guest: ${details.name}`,
    `Phone: ${details.phone || "not provided"}`,
    `Seating: ${details.seating}`,
    `Special occasion: ${details.remark.trim() || "none"}`,
    `Restaurant: ${RESTAURANT.name}, ${RESTAURANT.address}`,
    details.created_at ? `Booked at: ${details.created_at}` : undefined,
  ].filter((line): line is string => line !== undefined);

  return { subject, text: lines.join("\n") };
}

export function buildCallbackEmail(details: CallbackEmailDetails): {
  subject: string;
  text: string;
} {
  const guest = details.name?.trim() || "Guest";
  const subject = `Callback request — ${guest} — ${details.phone}`;
  const lines = [
    "A caller asked for a callback from Hong Kong Cafe.",
    "",
    `Callback ID: ${details.callback_id}`,
    `Guest: ${guest}`,
    `Phone: ${details.phone}`,
    details.created_at ? `Requested at: ${details.created_at}` : undefined,
  ].filter((line): line is string => line !== undefined);

  return { subject, text: lines.join("\n") };
}

// Notification email is best-effort: a failure must never fail the operation
// being notified about, so callers only log/return the outcome.
async function deliverEmail(
  content: { subject: string; text: string },
  events: EmailEvents,
): Promise<EmailResult> {
  const apiKey = getRuntimeSecret("EMAIL_API_KEY");
  const to = getRuntimeSecret("BOOKING_NOTIFICATION_EMAIL");
  const from = getRuntimeSecret("EMAIL_FROM") ?? DEFAULT_FROM;

  if (!apiKey || !to) {
    logEvent("warn", events.skipped, {
      route: events.route,
      outcome: "failed",
      error_code: "not_configured",
      result: events.resultId,
    });
    return { sent: false, reason: "not_configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: content.subject,
        text: content.text,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let providerError: string | undefined;
      try {
        const body = await response.text();
        providerError = body.slice(0, 200);
      } catch {
        providerError = undefined;
      }

      logEvent("warn", events.failed, {
        route: events.route,
        outcome: "failed",
        error_code: "provider_rejected",
        status: response.status,
        result: events.resultId,
        provider_error: providerError,
      });
      return { sent: false, reason: "send_failed" };
    }

    logEvent("info", events.sent, {
      route: events.route,
      outcome: "success",
      result: events.resultId,
    });
    return { sent: true };
  } catch {
    logEvent("warn", events.failed, {
      route: events.route,
      outcome: "failed",
      error_code: "request_failed",
      result: events.resultId,
    });
    return { sent: false, reason: "send_failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendBookingEmail(
  details: BookingEmailDetails,
): Promise<EmailResult> {
  return deliverEmail(buildBookingEmail(details), {
    route: "email:booking",
    skipped: "booking_email_skipped",
    sent: "booking_email_sent",
    failed: "booking_email_failed",
    resultId: details.reservation_id,
  });
}

export async function sendCallbackEmail(
  details: CallbackEmailDetails,
): Promise<EmailResult> {
  return deliverEmail(buildCallbackEmail(details), {
    route: "email:callback",
    skipped: "callback_email_skipped",
    sent: "callback_email_sent",
    failed: "callback_email_failed",
    resultId: details.callback_id,
  });
}
