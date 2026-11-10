import { z } from "zod";
import type { AppBindings } from "../env";
import { checkAvailability } from "../core/availability-service";
import { createReservation } from "../core/booking-service";
import { requestCallback } from "../core/callback-service";
import { dailyMenu, restaurantInfo } from "../core/faq-service";
import {
  recordMisunderstandingBySessionToken,
  type MisunderstandingStage,
} from "../core/misunderstanding";
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
    name: "create_reservation",
    description:
      "Create a reservation after the caller clearly confirms the date, time, party size, name, and phone number. Use the selection_token from check_availability.",
    inputSchema: z.toJSONSchema(createReservationInput),
    async handler(argumentsValue, context) {
      const parsed = createReservationInput.safeParse(argumentsValue);
      if (!parsed.success) {
        return toolError({
          ok: false,
          code: "invalid_arguments",
          message:
            "Provide a selection token, guest name, and valid phone number.",
        });
      }

      try {
        const result = await createReservation(
          context.env,
          parsed.data.selection_token,
          parsed.data.name,
          parsed.data.phone,
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
      "Save a callback request only after the caller provides and confirms a phone number. Returns a saved callback id or an honest failure.",
    inputSchema: z.toJSONSchema(callbackInput),
    async handler(argumentsValue, context) {
      const parsed = callbackInput.safeParse(argumentsValue);
      if (!parsed.success) {
        return toolError({
          ok: false,
          code: "invalid_arguments",
          message: "Provide a valid session token and callback phone number.",
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
        return unexpectedToolError();
      }
    },
  },
];

export function findTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}
