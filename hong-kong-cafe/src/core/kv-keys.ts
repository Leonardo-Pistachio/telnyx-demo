export const RESERVATIONS_FLAG_KEY = "feature/reservations_enabled";

export function sessionKey(token: string): string {
  return `session/${token}`;
}

export function selectionKey(token: string): string {
  return `selection/${token}`;
}
