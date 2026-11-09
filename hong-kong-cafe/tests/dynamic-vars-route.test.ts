import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { RESERVATIONS_FLAG_KEY } from "../src/core/dynamic-variables";

class MemoryKv {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

function base64(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value)));
}

const originalPublicKey = process.env.TELNYX_PUBLIC_KEY;
let privateKey: CryptoKey;
let publicKey: string;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  privateKey = pair.privateKey;
  publicKey = base64(await crypto.subtle.exportKey("raw", pair.publicKey));
  process.env.TELNYX_PUBLIC_KEY = publicKey;
});

afterAll(() => {
  if (originalPublicKey === undefined) {
    delete process.env.TELNYX_PUBLIC_KEY;
  } else {
    process.env.TELNYX_PUBLIC_KEY = originalPublicKey;
  }
});

async function postDynamicVariables(body: string, validSignature: boolean) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    new TextEncoder().encode(`${timestamp}|${body}`),
  );
  const kv = new MemoryKv();
  kv.values.set(RESERVATIONS_FLAG_KEY, "true");

  return app.request(
    "http://localhost/webhook/dynamic-vars",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "telnyx-signature-ed25519": validSignature
          ? base64(signature)
          : base64(new Uint8Array(64).buffer),
        "telnyx-timestamp": timestamp,
      },
      body,
    },
    { CAFE_KV: kv } as never,
  );
}

describe("dynamic-variables HTTP route", () => {
  it("verifies the signature and returns session variables", async () => {
    const body = JSON.stringify({
      data: {
        id: "event_1",
        event_type: "assistant.initialization",
        payload: {
          call_control_id: "v3:test-call",
          telnyx_end_user_target: "+85291234567",
        },
      },
    });

    const response = await postDynamicVariables(body, true);
    const result = (await response.json()) as {
      dynamic_variables: Record<string, string>;
    };

    expect(response.status).toBe(200);
    expect(result.dynamic_variables.reservations_enabled).toBe("true");
    expect(result.dynamic_variables.call_support_available).toBe("true");
    expect(result.dynamic_variables.call_session_token).toMatch(/^sess_/);
    expect(result.dynamic_variables).not.toHaveProperty("caller_number");
  });

  it("rejects a forged signature", async () => {
    const response = await postDynamicVariables(
      JSON.stringify({
        data: {
          id: "event_2",
          payload: { call_control_id: "v3:test-call" },
        },
      }),
      false,
    );

    expect(response.status).toBe(403);
  });
});
