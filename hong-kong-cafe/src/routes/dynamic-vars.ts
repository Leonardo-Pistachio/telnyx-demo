import { Hono } from "hono";
import { z } from "zod";
import {
  buildDynamicVariables,
  safeFallback,
} from "../core/dynamic-variables";
import type { AppBindings } from "../env";
import { logEvent, maskPhone, newRequestId } from "../lib/logger";
import { getRuntimeSecret } from "../lib/secrets";
import { verifyTelnyxSignature } from "../lib/signatures";

const dynamicVariablesRequestSchema = z
  .object({
    data: z
      .object({
        id: z.string().optional(),
        event_type: z.string().optional(),
        payload: z
          .object({
            call_control_id: z.string().min(1).optional(),
            telnyx_end_user_target: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const dynamicVariablesRoutes = new Hono<{ Bindings: AppBindings }>();

dynamicVariablesRoutes.post("/webhook/dynamic-vars", async (context) => {
  const startedAt = performance.now();
  const rawBody = await context.req.text();
  const publicKey = getRuntimeSecret("TELNYX_PUBLIC_KEY");
  const signature = context.req.header("telnyx-signature-ed25519");
  const timestamp = context.req.header("telnyx-timestamp");
  const requestId = newRequestId();

  const validSignature = await verifyTelnyxSignature(
    rawBody,
    { signature, timestamp },
    publicKey,
  );

  if (!validSignature) {
    logEvent("warn", "dynamic_variables_rejected", {
      request_id: requestId,
      route: "/webhook/dynamic-vars",
      outcome: "rejected",
      error_code: "invalid_signature",
      latency_ms: Math.round(performance.now() - startedAt),
    });
    return context.json({ error: "invalid signature" }, 403);
  }

  let parsed: z.infer<typeof dynamicVariablesRequestSchema>;
  try {
    parsed = dynamicVariablesRequestSchema.parse(JSON.parse(rawBody));
  } catch {
    logEvent("warn", "dynamic_variables_rejected", {
      request_id: requestId,
      route: "/webhook/dynamic-vars",
      outcome: "rejected",
      error_code: "bad_request",
      latency_ms: Math.round(performance.now() - startedAt),
    });
    return context.json({ error: "invalid payload" }, 400);
  }

  const payload = parsed.data.payload;
  const eventId = parsed.data.id ?? requestId;

  try {
    const result = await buildDynamicVariables(
      { callControlId: payload?.call_control_id },
      { kv: context.env.CAFE_KV },
    );

    logEvent("info", "dynamic_variables_resolved", {
      request_id: eventId,
      correlation_id: payload?.call_control_id,
      caller: maskPhone(payload?.telnyx_end_user_target),
      route: "/webhook/dynamic-vars",
      node: "initialization",
      outcome:
        result.featureFlagFailed || result.sessionFailed ? "failed" : "success",
      error_code: result.sessionFailed
        ? "session_store_unavailable"
        : result.featureFlagFailed
          ? "feature_flag_unavailable"
          : undefined,
      latency_ms: Math.round(performance.now() - startedAt),
      result: `reservations_enabled=${result.variables.reservations_enabled};call_support_available=${result.variables.call_support_available}`,
    });

    return context.json({ dynamic_variables: result.variables });
  } catch {
    const variables = safeFallback();
    logEvent("error", "dynamic_variables_failed", {
      request_id: eventId,
      correlation_id: payload?.call_control_id,
      caller: maskPhone(payload?.telnyx_end_user_target),
      route: "/webhook/dynamic-vars",
      node: "initialization",
      outcome: "failed",
      error_code: "unexpected_failure",
      latency_ms: Math.round(performance.now() - startedAt),
    });

    return context.json({ dynamic_variables: variables });
  }
});
