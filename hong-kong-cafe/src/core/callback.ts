import type { KvNamespace } from "@telnyx/edge-runtime";
import { normalizeContact } from "./contact";
import { callbackKey } from "./kv-keys";

export const CALLBACK_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface CallbackRecord {
  callback_id: string;
  call_id: string;
  name?: string;
  phone: string;
  created_at: string;
}

export type CallbackSaveResult =
  | { ok: true; status: "saved" | "already_saved"; record: CallbackRecord }
  | { ok: false; code: "invalid_name" | "invalid_phone" | "conflict"; message: string };

export async function hashIdentifier(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );

  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function saveCallback(
  kv: KvNamespace,
  callId: string,
  name: string | undefined,
  phone: string,
  now = new Date(),
): Promise<CallbackSaveResult> {
  const contact = normalizeContact(name, phone, false);
  if (!contact.ok) {
    return {
      ok: false,
      code: contact.code,
      message: contact.message,
    };
  }

  const callIdHash = await hashIdentifier(callId);
  const key = callbackKey(callIdHash);
  const existing = await kv.get<CallbackRecord>(key, { type: "json" });

  if (existing) {
    if (existing.phone !== contact.value.phone) {
      return {
        ok: false,
        code: "conflict",
        message: "A callback was already saved for this call.",
      };
    }

    return { ok: true, status: "already_saved", record: existing };
  }

  const record: CallbackRecord = {
    callback_id: `cb_${crypto.randomUUID()}`,
    call_id: callId,
    name: contact.value.name,
    phone: contact.value.phone,
    created_at: now.toISOString(),
  };

  await kv.put(key, JSON.stringify(record), {
    expirationTtl: CALLBACK_TTL_SECONDS,
  });

  return { ok: true, status: "saved", record };
}
