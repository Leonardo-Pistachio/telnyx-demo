import type { AppBindings } from "../env";
import { normalizeContact } from "./contact";
import { sendCallbackEmail } from "./email-service";
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
      code:
        | "invalid_session"
        | "invalid_name"
        | "invalid_phone"
        | "store_unavailable";
      message: string;
    };

export async function requestCallback(
  env: AppBindings,
  sessionToken: string,
  phone: string,
  name?: string,
): Promise<RequestCallbackResult> {
  try {
    const callId = await resolveSessionCallId(env.CAFE_KV, sessionToken);
    if (!callId) {
      return {
        ok: false,
        code: "invalid_session",
        message: "This call session is no longer available.",
      };
    }

    const contact = normalizeContact(name, phone, false);
    if (!contact.ok) {
      return {
        ok: false,
        code: contact.code,
        message: contact.message,
      };
    }

    const session = env.CALL_SESSION.idFromName(callId);
    const result = await session.saveCallback({
      callbackId: `cb_${crypto.randomUUID()}`,
      name: contact.value.name,
      phone: contact.value.phone,
      createdAt: new Date().toISOString(),
    });

    if (result.status === "saved") {
      await sendCallbackEmail({
        callback_id: result.callback.callback_id,
        name: result.callback.name,
        phone: result.callback.phone,
        created_at: result.callback.created_at,
      });
    }

    return {
      ok: true,
      status: result.status,
      callback: {
        callback_id: result.callback.callback_id,
        name: result.callback.name,
        created_at: result.callback.created_at,
      },
    };
  } catch {
    return {
      ok: false,
      code: "store_unavailable",
      message:
        "I could not save the callback right now. Please try once more or take the number manually.",
    };
  }
}
