export interface NormalizedContact {
  name?: string;
  phone: string;
}

export type ContactResult =
  | { ok: true; value: NormalizedContact }
  | { ok: false; code: "invalid_name" | "invalid_phone"; message: string };

export function normalizeGuestName(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

export function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 40 ||
    !/^\+?[\d\s().-]+$/.test(trimmed)
  ) {
    return null;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;

  if (digits.length === 8) return `+852${digits}`;
  return `+${digits}`;
}

export function normalizeContact(
  name: string | undefined,
  phone: string,
  nameRequired: boolean,
): ContactResult {
  const normalizedName = normalizeGuestName(name);
  if (nameRequired && !normalizedName) {
    return {
      ok: false,
      code: "invalid_name",
      message: "Please provide a name for the reservation.",
    };
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return {
      ok: false,
      code: "invalid_phone",
      message: "Please provide a valid phone number.",
    };
  }

  return {
    ok: true,
    value: {
      name: normalizedName ?? undefined,
      phone: normalizedPhone,
    },
  };
}
