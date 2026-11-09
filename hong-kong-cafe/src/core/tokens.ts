import type { KvNamespace } from "@telnyx/edge-runtime";
import { selectionKey, sessionKey } from "./kv-keys";

export const SELECTION_TOKEN_TTL_SECONDS = 10 * 60;

const SESSION_TOKEN_PATTERN =
  /^sess_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SELECTION_TOKEN_PATTERN =
  /^sel_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SessionRecord {
  call_id: string;
  created_at: string;
}

export interface SelectionRecord {
  date: string;
  time: string;
  party_size: number;
  created_at: string;
}

export function newSessionToken(): string {
  return `sess_${crypto.randomUUID()}`;
}

export function newSelectionToken(): string {
  return `sel_${crypto.randomUUID()}`;
}

export function isSessionToken(value: string): boolean {
  return SESSION_TOKEN_PATTERN.test(value);
}

export function isSelectionToken(value: string): boolean {
  return SELECTION_TOKEN_PATTERN.test(value);
}

export async function resolveSessionCallId(
  kv: KvNamespace,
  token: string,
): Promise<string | null> {
  if (!isSessionToken(token)) return null;

  const record = await kv.get<SessionRecord>(sessionKey(token), {
    type: "json",
  });

  if (
    !record ||
    typeof record.call_id !== "string" ||
    record.call_id.length === 0 ||
    record.call_id.length > 200
  ) {
    return null;
  }

  return record.call_id;
}

export async function saveSelection(
  kv: KvNamespace,
  selection: SelectionRecord,
): Promise<string> {
  const token = newSelectionToken();
  await kv.put(
    selectionKey(token),
    JSON.stringify(selection),
    { expirationTtl: SELECTION_TOKEN_TTL_SECONDS },
  );
  return token;
}

export async function readSelection(
  kv: KvNamespace,
  token: string,
): Promise<SelectionRecord | null> {
  if (!isSelectionToken(token)) return null;

  const record = await kv.get<SelectionRecord>(
    selectionKey(token),
    { type: "json" },
  );

  if (
    !record ||
    typeof record.date !== "string" ||
    typeof record.time !== "string" ||
    typeof record.party_size !== "number" ||
    typeof record.created_at !== "string"
  ) {
    return null;
  }

  return record;
}
