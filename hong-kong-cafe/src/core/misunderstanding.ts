import type { AppBindings } from "../env";
import { resolveSessionCallId } from "./tokens";

export type MisunderstandingStage =
  | "intent"
  | "reservation"
  | "confirmation"
  | "faq";

export type MisunderstandingResult =
  | {
      ok: true;
      count: number;
      should_escalate: boolean;
      newly_reached_threshold: boolean;
    }
  | { ok: false; code: "invalid_session"; message: string };

export async function recordMisunderstandingBySessionToken(
  env: AppBindings,
  sessionToken: string,
  _stage: MisunderstandingStage,
): Promise<MisunderstandingResult> {
  const callId = await resolveSessionCallId(env.CAFE_KV, sessionToken);
  if (!callId) {
    return {
      ok: false,
      code: "invalid_session",
      message: "This call session is no longer available.",
    };
  }

  const result = await recordMisunderstandingByCallId(env, callId);
  return {
    ok: true,
    count: result.count,
    should_escalate: result.shouldEscalate,
    newly_reached_threshold: result.newlyReachedThreshold,
  };
}

export async function recordMisunderstandingByCallId(
  env: AppBindings,
  callId: string,
) {
  const session = env.CALL_SESSION.idFromName(callId);
  return session.recordMisunderstanding();
}
