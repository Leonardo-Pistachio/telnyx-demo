import { decodeBase64Url } from "./auth";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export interface SignatureHeaders {
  signature?: string;
  timestamp?: string;
}

export async function verifyTelnyxSignature(
  rawBody: string,
  headers: SignatureHeaders,
  publicKeyBase64: string | undefined,
  now = new Date(),
): Promise<boolean> {
  if (!publicKeyBase64 || !headers.signature || !headers.timestamp) {
    return false;
  }

  const timestamp = Number(headers.timestamp);
  if (!Number.isSafeInteger(timestamp)) return false;

  const skew = Math.abs(now.getTime() / 1000 - timestamp);
  if (skew > MAX_CLOCK_SKEW_SECONDS) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      decodeBase64Url(publicKeyBase64),
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    const signedPayload = new TextEncoder().encode(
      `${headers.timestamp}|${rawBody}`,
    );

    return await crypto.subtle.verify(
      "Ed25519",
      key,
      decodeBase64Url(headers.signature),
      signedPayload,
    );
  } catch {
    return false;
  }
}
