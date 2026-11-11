import { z } from "zod";
import type { AppBindings } from "../env";
import { checkAvailability } from "../core/availability-service";
import { createReservation } from "../core/booking-service";
import { changeReservationDate } from "../core/change-date-service";
import { requestCallback } from "../core/callback-service";
import { dailyMenu, restaurantInfo } from "../core/faq-service";
import { lookupReservation } from "../core/lookup-service";
import {
  recordMisunderstandingBySessionToken,
  type MisunderstandingStage,
} from "../core/misunderstanding";
import { getWeather } from "../core/weather";
import { logEvent } from "../lib/logger";
import type { HongKongNow } from "../lib/time";

export interface McpToolContext {
  env: AppBindings;
  now?: HongKongNow;
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (
    argumentsValue: unknown,
    context: McpToolContext,
  ) => Promise<McpToolResult>;
}

function toolResult(value: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function toolError(value: unknown): McpToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function unexpectedToolError(): McpToolResult {
  return toolError({
    ok: false,
    code: "service_unavailable",
    message: "The request could not be completed. Do not assume it succeeded.",
  });
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Calendar date in YYYY-MM-DD format, Hong Kong time.");
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .describe("Reservation start time in 24-hour HH:mm format.");
const partySizeSchema = z
  .number()
  .int()
  .describe("Number of guests as a whole number.");
const sessionTokenSchema = z
  .string()
  .min(1)
  .max(200)
  .describe("Opaque call session token supplied in dynamic variables.");

// Models sometimes send a phone as a JSON number. Coerce before validation so
// a bare numeric number is not rejected as a schema error.
function coercePhoneArgument(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return typeof record.phone === "number"
    ? { ...record, phone: String(record.phone) }
    : value;
}

const restaurantInfoInput = z.object({
  topic: z
    .enum(["hours", "address"])
    .describe("The restaurant information the caller wants."),
  session_token: sessionTokenSchema.optional(),
});

const dailyMenuInput = z.object({
  date: dateSchema.optional().describe("Optional menu date; defaults to today."),
  session_token: sessionTokenSchema.optional(),
});

const availabilityInput = z.object({
  date: dateSchema,
  time: timeSchema,
  party_size: partySizeSchema,
  session_token: sessionTokenSchema.optional(),
});

const createReservationInput = z.object({
  selection_token: z
    .string()
    .min(1)
    .max(200)
    .describe("Selection token returned by check_availability."),
  name: z.string().min(1).max(80).describe("Guest name."),
  phone: z.string().min(8).max(40).describe("Caller's phone number."),
  seating: z
    .enum(["inside", "outside"])
    .optional()
    .describe(
      "Guest seating preference. Defaults to inside. Check the weather before offering outside.",
    ),
  remark: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Short note about a special occasion or request, if the caller mentions one.",
    ),
  session_token: sessionTokenSchema.optional(),
});

const weatherInput = z.object({
  date: dateSchema.describe("The booking date to check, in YYYY-MM-DD format."),
  session_token: sessionTokenSchema.optional(),
});

const lookupReservationInput = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .describe("Guest name as booked, or their surname."),
  phone: z
    .string()
    .min(8)
    .max(40)
    .describe("Phone number used for the booking."),
  date: dateSchema.describe("The date the booking is currently on."),
  session_token: sessionTokenSchema.optional(),
});

const changeReservationDateInput = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .describe("Guest name as booked, or their surname."),
  phone: z
    .string()
    .min(8)
    .max(40)
    .describe("Phone number used for the booking."),
  current_date: dateSchema.describe("The date the booking is currently on."),
  new_date: dateSchema.describe("The new date to move the booking to."),
  session_token: sessionTokenSchema.optional(),
});

const misunderstandingInput = z.object({
  session_token: sessionTokenSchema,
  stage: z.enum(["intent", "reservation", "confirmation", "faq"]),
});

const callbackInput = z.object({
  session_token: sessionTokenSchema,
  phone: z.string().min(8).max(40).describe("Callback phone number."),
  name: z.string().min(1).max(80).optional(),
});

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "get_restaurant_info",
    description:
      "Get Hong Kong Cafe's opening hours or street address. Use this instead of guessing.",
    inputSchema: z.toJSONSchema(restaurantInfoInput),
    async handler(argumentsValue) {
      const parsed = restaurantInfoInput.safeParse(argumentsValue);
      if (!parsed.success) {
        return toolError({
          ok: false,
          code: "invalid_arguments",
          message: "Provide topic as either hours or address.",
        });
      }
      return toolResult(restaurantInfo(parsed.data.topic));
    },
  },
  {
    name: "get_daily_menu",
    description:
      "Get today's or a specific date's dinner menu for Hong Kong Cafe.",
    inputSchema: z.toJSONSchema(dailyMenuInput),
    async handler(argumentsValue) {
      const parsed = dailyMenuInput.safeParse(argumentsValue);
      if (!parsed.success) {
        return toolError({
          ok: false,
          code: "invalid_arguments",
          message: "Provide a valid optional date in YYYY-MM-DD format.",
        });
      }

      const result = dailyMenu(parsed.data.date);
      return result.ok ? toolResult(result) : toolError(result);
    },
  },
  {
    name: "check_availability",
    description:
      "Check whether a date, time, and party size can be booked. Returns nearby alternatives and a selection_token only when the requested time is available.",
    inputSchema: z.toJSONSchema(availabilityInput),
    async handler(argumentsValue, context) {
      const parsed = availabilityInput.safeParse(argumentsValue);
      if (!parsed.success) {
        return toolError({
          ok: false,
          code: "invalid_arguments",
          message: "Provide a valid date, time, and whole-number party size.",
        });
      }

      try {
        const result = await checkAvailability(
          context.env,
          parsed.data.date,
          parsed.data.time,
          parsed.data.party_size,
          context.now,
        );
        return result.ok ? toolResult(result) : toolError(result);
      } catch {
        return unexpectedToolError();
      }
    },
  },
  {
    name: "check_weather",
    description:
      "Check the weather for outdoor seating on a booking date. Weekends are rainy and outdoor seating is closed; weekdays are sunny and outdoor seating is open. Call this before offering or confirming outside seating.",
    inputSchema: z.toJSONSchema(weatherInput),
    async handler(argumentsValue) {
      const parsed = weatherInput.safeParse(argumentsValue);
      if (!parsed.success) {
        return toolError({
          ok: false,
          code: "invalid_arguments",
          message: "Provide a valid date in YYYY-MM-DD format.",
        });
      }

      try {
        return toolResult(getWeather(parsed.data.date));
      } catch {
        return toolError({
          ok: false,
          code: "invalid_arguments",
          message: "Provide a valid date in YYYY-MM-DD format.",
        });
      }
    },
  },
  {
    name: "create_reservation",
    description:
      "Create a reservation after the caller clearly confirms the date, time, party size, name, and phone number. Bookings last one hour and parties are limited to 10 guests; larger parties need a callback. Use the selection_token from check_availability. Pass the caller's inside/outside preference and any special occasion as remark. Outside requests fail when the weather check says outdoor seating is closed.",
    inputSchema: z.toJSONSchema(createReservationInput),
    async handler(argumentsValue, context) {
      const parsed = createReservationInput.safeParse(
        coercePhoneArgument(argumentsValue),
      );
      if (!parsed.success) {
        return toolError({
          ok: false,
          code: "invalid_arguments",
          message:
            "Provide a selection token, guest name, valid phone number, and optional seating or remark.",
        });
      }

      try {
        const result = await createReservation(
          context.env,
          parsed.data.selection_token,
          parsed.data.name,
          parsed.data.phone,
          {
            seating: parsed.data.seating,
            remark: parsed.data.remark,
          },
          context.now,
        );
        logEvent(
          result.ok || result.code === "slot_taken" ? "info" : "warn",
          result.ok
            ? "booking_created"
            : result.code === "slot_taken"
              ? "slot_taken"
              : "booking_failed",
          {
            route: "mcp:create_reservation",
            node: "mcp",
            tool: "create_reservation",
            outcome: result.ok ? "success" : "rejected",
            error_code: result.ok ? undefined : result.code,
            result: result.ok ? result.status : result.code,
          },
        );
        return result.ok ? toolResult(result) : toolError(result);
      } catch {
        return unexpectedToolError();
      }
    },
  },
  {
    name: "lookup_reservation",
    description:
      "Retrieve an existing booking ONLY when the caller provides the booking name (or surname), phone number, and date. Never reveal, confirm, or hint at any booking detail unless this tool returns ok true. A not_found result must never be used to guess or disclose anything.",
    inputSchema: z.toJSONSchema(lookupReservationInput),
    async handler(argumentsValue, context) {
      const parsed = lookupReservationInput.safeParse(
        coercePhoneArgument(argumentsValue),
      );
      if (!parsed.success) {
        return toolError({
          ok: false,
          code: "invalid_arguments",
          message: "Provide the booking name, phone number, and date.",
        });
      }

      try {
        const result = await lookupReservation(
          context.env,
          parsed.data.name,
          parsed.data.phone,
          parsed.data.date,
        );
        logEvent(result.ok ? "info" : "warn", "reservation_lookup", {
          route: "mcp:lookup_reservation",
          node: "mcp",
          tool: "lookup_reservation",
          outcome: result.ok ? "success" : "rejected",
          error_code: result.ok ? undefined : result.code,
          result: result.ok ? "found" : result.code,
        });
        return result.ok ? toolResult(result) : toolError(result);
      } catch {
        return unexpectedToolError();
      }
    },
  },
  {
    name: "change_reservation_date",
    description:
      "Move an existing booking to another date, keeping the same time, party size, seating, and remark. Requires the booking name (or surname), phone number, and current date; the tool re-verifies all three before changing anything. Only report the new date after ok true.",
    inputSchema: z.toJSONSchema(changeReservationDateInput),
    async handler(argumentsValue, context) {
      const parsed = changeReservationDateInput.safeParse(
        coercePhoneArgument(argumentsValue),
      );
      if (!parsed.success) {
        return toolError({
          ok: false,
          code: "invalid_arguments",
          message:
            "Provide the booking name, phone number, current date, and new date.",
        });
      }

      try {
        const result = await changeReservationDate(
          context.env,
          parsed.data.name,
          parsed.data.phone,
          parsed.data.current_date,
          parsed.data.new_date,
          context.now,
        );
        logEvent(result.ok ? "info" : "warn", "reservation_moved", {
          route: "mcp:change_reservation_date",
          node: "mcp",
          tool: "change_reservation_date",
          outcome: result.ok ? "success" : "rejected",
          error_code: result.ok ? undefined : result.code,
          result: result.ok ? "moved" : result.code,
        });
        return result.ok ? toolResult(result) : toolError(result);
      } catch {
        return unexpectedToolError();
      }
    },
  },
  {
    name: "record_misunderstanding",
    description:
      "Record that the caller could not be understood at a workflow stage. Returns the per-call count and whether escalation is required.",
    inputSchema: z.toJSONSchema(misunderstandingInput),
    async handler(argumentsValue, context) {
      const parsed = misunderstandingInput.safeParse(argumentsValue);
      if (!parsed.success) {
        return toolError({
          ok: false,
          code: "invalid_arguments",
          message: "Provide a valid session token and stage.",
        });
      }

      try {
        const result = await recordMisunderstandingBySessionToken(
          context.env,
          parsed.data.session_token,
          parsed.data.stage as MisunderstandingStage,
        );
        return result.ok ? toolResult(result) : toolError(result);
      } catch {
        return unexpectedToolError();
      }
    },
  },
  {
    name: "request_callback",
    description:
      "Save a callback request for the trusted call and email it to the restaurant. Collect and read back the caller's full phone number (at least 8 digits) first. Returns a saved callback id or an honest failure.",
    inputSchema: z.toJSONSchema(callbackInput),
    async handler(argumentsValue, context) {
      const parsed = callbackInput.safeParse(
        coercePhoneArgument(argumentsValue),
      );
      if (!parsed.success) {
        logEvent("warn", "callback_failed", {
          route: "mcp:request_callback",
          node: "mcp",
          tool: "request_callback",
          outcome: "rejected",
          error_code: "invalid_arguments",
          result:
            parsed.error.issues
              .map((issue) => issue.path.map(String).join("."))
              .filter(Boolean)
              .join(",") || "arguments",
        });
        return toolError({
          ok: false,
          code: "invalid_arguments",
          message:
            "The callback number was not captured correctly. Collect and read back the full phone number, at least 8 digits, and try again.",
        });
      }

      try {
        const result = await requestCallback(
          context.env,
          parsed.data.session_token,
          parsed.data.phone,
          parsed.data.name,
        );
        logEvent(result.ok ? "info" : "warn", result.ok ? "callback_saved" : "callback_failed", {
          route: "mcp:request_callback",
          node: "mcp",
          tool: "request_callback",
          outcome: result.ok ? "success" : "rejected",
          error_code: result.ok ? undefined : result.code,
          result: result.ok ? result.status : result.code,
        });
        return result.ok ? toolResult(result) : toolError(result);
      } catch {
        logEvent("warn", "callback_failed", {
          route: "mcp:request_callback",
          node: "mcp",
          tool: "request_callback",
          outcome: "failed",
          error_code: "unexpected_failure",
        });
        return unexpectedToolError();
      }
    },
  },
];

export function findTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}
