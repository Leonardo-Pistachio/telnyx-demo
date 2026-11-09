import type { AppBindings } from "../env";
import { saveCallback, type CallbackRecord } from "./callback";
import { resolveSessionCallId } from "./tokens";

export type RequestCallbackResult =
  | {
      ok: true;
      status: "saved" | "already_saved";
      callback: {
        callback_id: string;
        name?: string;
        created_at: string;
      };
    }
  | {
      ok: false;
      code: "invalid_session" | "invalid_name" | "invalid_phone" | "conflict";
      message: string;
    };

export async function requestCallback(
  env: AppBindings,
  sessionToken: string,
  phone: string,
  name?: string,
): Promise<RequestCallbackResult> {
  const callId = await resolveSessionCallId(env.CAFE_KV, sessionToken);
  if (!callId) {
    return {
      ok: false,
      code: "invalid_session",
      message: "This call session is no longer available.",
    };
  }

  const result = await saveCallback(env.CAFE_KV, callId, name, phone);
  if (!result.ok) {
    return result;
  }

  const callback: CallbackRecord = result.record;
  return {
    ok: true,
    status: result.status,
    callback: {
      callback_id: callback.callback_id,
      name: callback.name,
      created_at: callback.created_at,
    },
  };
}
