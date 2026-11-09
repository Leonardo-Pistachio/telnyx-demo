import type { KvNamespace } from "@telnyx/edge-runtime";
import { RESTAURANT } from "../data/restaurant";
import { getHongKongNow, timeToMinutes } from "../lib/time";
import { RESERVATIONS_FLAG_KEY, sessionKey } from "./kv-keys";

export { RESERVATIONS_FLAG_KEY };
export const SESSION_TOKEN_TTL_SECONDS = 4 * 60 * 60;

export interface DynamicVariableInput {
  callControlId?: string;
}

export interface DynamicVariableDependencies {
  kv: KvNamespace;
  now?: Date;
  createToken?: () => string;
}

export interface DynamicVariables {
  reservations_enabled: string;
  call_support_available: string;
  call_session_token: string;
  is_open_now: string;
  today_date: string;
  restaurant_name: string;
  restaurant_address: string;
}

export interface DynamicVariableResult {
  variables: DynamicVariables;
  featureFlagFailed: boolean;
  sessionFailed: boolean;
}

function safeFallback(now = new Date()): DynamicVariables {
  return {
    reservations_enabled: "false",
    call_support_available: "false",
    call_session_token: "",
    is_open_now: isOpenNow(now),
    today_date: getHongKongNow(now).date,
    restaurant_name: RESTAURANT.name,
    restaurant_address: RESTAURANT.address,
  };
}

export function isOpenNow(now = new Date()): string {
  const hongKongNow = getHongKongNow(now);
  const openingMinutes = timeToMinutes(RESTAURANT.openingTime);
  const closingMinutes = timeToMinutes(RESTAURANT.closingTime);

  return String(
    hongKongNow.minutes >= openingMinutes &&
      hongKongNow.minutes < closingMinutes,
  );
}

export async function buildDynamicVariables(
  input: DynamicVariableInput,
  dependencies: DynamicVariableDependencies,
): Promise<DynamicVariableResult> {
  const now = dependencies.now ?? new Date();
  const createToken =
    dependencies.createToken ?? (() => `sess_${crypto.randomUUID()}`);
  const variables = safeFallback(now);
  let featureFlagFailed = false;
  let sessionFailed = false;

  try {
    const flag = await dependencies.kv.get(RESERVATIONS_FLAG_KEY);
    variables.reservations_enabled = flag === "true" ? "true" : "false";
  } catch {
    featureFlagFailed = true;
  }

  if (!input.callControlId) {
    sessionFailed = true;
    return { variables, featureFlagFailed, sessionFailed };
  }

  try {
    const token = createToken();
    await dependencies.kv.put(
      sessionKey(token),
      JSON.stringify({
        call_id: input.callControlId,
        created_at: new Date(now).toISOString(),
      }),
      { expirationTtl: SESSION_TOKEN_TTL_SECONDS },
    );
    variables.call_session_token = token;
    variables.call_support_available = "true";
  } catch {
    sessionFailed = true;
  }

  return { variables, featureFlagFailed, sessionFailed };
}

export { safeFallback };
