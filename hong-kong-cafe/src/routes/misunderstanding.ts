import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import { recordMisunderstandingByCallId } from "../core/misunderstanding";
import { logEvent, newRequestId } from "../lib/logger";
import { getRuntimeSecret } from "../lib/secrets";
import { verifyTelnyxSignature } from "../lib/signatures";

const stages = ["intent", "reservation", "confirmation", "faq"] as const;
const bodySchema = z.object({
  call_id: z.string().min(1).max(200),
});

export const misunderstandingRoutes = new Hono<{
  Bindings: AppBindings;
}>();

misunderstandingRoutes.post(
  "/webhook/misunderstanding/:stage",
  async (context) => {
    const startedAt = performance.now();
    const requestId = newRequestId();
    const stage = context.req.param("stage");
    const rawBody = await context.req.text();

    if (!stages.includes(stage as (typeof stages)[number])) {
      return context.json({ error: "not found" }, 404);
    }

    const validSignature = await verifyTelnyxSignature(
      rawBody,
      {
        signature: context.req.header("telnyx-signature-ed25519"),
        timestamp: context.req.header("telnyx-timestamp"),
      },
      getRuntimeSecret("TELNYX_PUBLIC_KEY"),
    );

    if (!validSignature) {
      logEvent("warn", "misunderstanding_rejected", {
        request_id: requestId,
        route: `/webhook/misunderstanding/${stage}`,
        node: `misunderstanding.${stage}`,
        outcome: "rejected",
        error_code: "invalid_signature",
        latency_ms: Math.round(performance.now() - startedAt),
      });
      return context.json({ error: "invalid signature" }, 403);
    }

    const parsed = bodySchema.safeParse(
      (() => {
        try {
          return JSON.parse(rawBody);
        } catch {
          return null;
        }
      })(),
    );

    if (!parsed.success) {
      logEvent("warn", "misunderstanding_rejected", {
        request_id: requestId,
        route: `/webhook/misunderstanding/${stage}`,
        node: `misunderstanding.${stage}`,
        outcome: "rejected",
        error_code: "bad_request",
        latency_ms: Math.round(performance.now() - startedAt),
      });
      return context.json({ error: "invalid payload" }, 400);
    }

    try {
      const result = await recordMisunderstandingByCallId(
        context.env,
        parsed.data.call_id,
      );
      const status = result.shouldEscalate ? 409 : 200;

      logEvent("info", "misunderstanding_recorded", {
        request_id: requestId,
        correlation_id: parsed.data.call_id,
        call_id: parsed.data.call_id,
        route: `/webhook/misunderstanding/${stage}`,
        node: `misunderstanding.${stage}`,
        outcome: "success",
        count: result.count,
        metric: result.shouldEscalate
          ? "escalated_to_callback"
          : "misunderstanding_recorded",
        latency_ms: Math.round(performance.now() - startedAt),
      });

      return context.json(
        {
          recorded: true,
          count: result.count,
          should_escalate: result.shouldEscalate,
        },
        status,
      );
    } catch {
      logEvent("error", "misunderstanding_failed", {
        request_id: requestId,
        correlation_id: parsed.data.call_id,
        call_id: parsed.data.call_id,
        route: `/webhook/misunderstanding/${stage}`,
        node: `misunderstanding.${stage}`,
        outcome: "failed",
        error_code: "store_unavailable",
        latency_ms: Math.round(performance.now() - startedAt),
      });
      return context.json({ error: "store unavailable" }, 500);
    }
  },
);
