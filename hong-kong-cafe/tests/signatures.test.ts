import { describe, expect, it } from "vitest";
import { verifyTelnyxSignature } from "../src/lib/signatures";

function base64(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value)));
}

async function createSignedRequest(body: string, timestamp: number) {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  const publicKey = await crypto.subtle.exportKey("raw", pair.publicKey);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    pair.privateKey,
    new TextEncoder().encode(`${timestamp}|${body}`),
  );

  return {
    publicKey: base64(publicKey),
    signature: base64(signature),
  };
}

describe("Telnyx signature verification", () => {
  it("accepts a valid current signature", async () => {
    const body = '{"data":{"id":"event_1"}}';
    const timestamp = 1_800_000_000;
    const signed = await createSignedRequest(body, timestamp);

    await expect(
      verifyTelnyxSignature(
        body,
        { signature: signed.signature, timestamp: String(timestamp) },
        signed.publicKey,
        new Date(timestamp * 1000),
      ),
    ).resolves.toBe(true);
  });

  it("rejects stale, tampered, or missing signatures", async () => {
    const body = '{"data":{"id":"event_1"}}';
    const timestamp = 1_800_000_000;
    const signed = await createSignedRequest(body, timestamp);

    await expect(
      verifyTelnyxSignature(
        `${body} `,
        { signature: signed.signature, timestamp: String(timestamp) },
        signed.publicKey,
        new Date(timestamp * 1000),
      ),
    ).resolves.toBe(false);

    await expect(
      verifyTelnyxSignature(
        body,
        { signature: signed.signature, timestamp: String(timestamp) },
        signed.publicKey,
        new Date((timestamp + 301) * 1000),
      ),
    ).resolves.toBe(false);

    await expect(
      verifyTelnyxSignature(body, {}, signed.publicKey),
    ).resolves.toBe(false);
  });
});
