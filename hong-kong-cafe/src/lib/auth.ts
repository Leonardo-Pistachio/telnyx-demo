function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

export async function constantTimeEqual(
  actual: string,
  expected: string,
): Promise<boolean> {
  const [actualHash, expectedHash] = await Promise.all([
    sha256(actual),
    sha256(expected),
  ]);

  let difference = 0;
  for (let index = 0; index < actualHash.length; index += 1) {
    difference |= actualHash[index]! ^ expectedHash[index]!;
  }

  return difference === 0;
}

export async function isAuthorizedBearer(
  authorization: string | undefined,
  expectedToken: string | undefined,
): Promise<boolean> {
  if (!expectedToken || !authorization) return false;
  const [scheme, token, ...extra] = authorization.trim().split(/\s+/);
  if (scheme !== "Bearer" || !token || extra.length > 0) return false;
  return constantTimeEqual(token, expectedToken);
}

export { decodeBase64Url };
