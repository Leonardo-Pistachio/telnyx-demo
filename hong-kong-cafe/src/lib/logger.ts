export type LogOutcome = "success" | "rejected" | "failed";

export interface LogFields {
  route: string;
  outcome: LogOutcome;
  latency_ms?: number;
  request_id?: string;
  correlation_id?: string;
  caller?: string;
  call_id?: string;
  node?: string;
  tool?: string;
  error_code?: string;
  metric?: string;
  count?: number;
}

export function maskPhone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

export function newRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}

export function logEvent(level: "info" | "warn" | "error", event: string, fields: LogFields): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  });

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
