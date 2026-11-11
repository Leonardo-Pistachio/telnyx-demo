import { StatefulActor } from "@telnyx/edge-runtime";

const MISUNDERSTANDING_COUNT_KEY = "misunderstanding_count";
const CALLBACK_RECORD_KEY = "callback_record";
export const ESCALATION_THRESHOLD = 3;

export interface MisunderstandingResult {
  count: number;
  shouldEscalate: boolean;
  newlyReachedThreshold: boolean;
}

export interface StoredCallback {
  callback_id: string;
  name?: string;
  phone: string;
  created_at: string;
}

export interface SaveCallbackInput {
  callbackId: string;
  name?: string;
  phone: string;
  createdAt: string;
}

export interface SaveCallbackResult {
  status: "saved" | "already_saved";
  callback: StoredCallback;
}

export class CallSession extends StatefulActor {
  async recordMisunderstanding(): Promise<MisunderstandingResult> {
    const count =
      (await this.ctx.storage.get<number>(MISUNDERSTANDING_COUNT_KEY)) ?? 0;

    if (count >= ESCALATION_THRESHOLD) {
      return {
        count,
        shouldEscalate: true,
        newlyReachedThreshold: false,
      };
    }

    const next = count + 1;
    await this.ctx.storage.put(MISUNDERSTANDING_COUNT_KEY, next);

    return {
      count: next,
      shouldEscalate: next >= ESCALATION_THRESHOLD,
      newlyReachedThreshold: next === ESCALATION_THRESHOLD,
    };
  }

  async misunderstandingCount(): Promise<number> {
    return (
      (await this.ctx.storage.get<number>(MISUNDERSTANDING_COUNT_KEY)) ?? 0
    );
  }

  // One callback per trusted call: the first save wins and retries return the
  // stored record, so the notification email is never sent twice.
  async saveCallback(input: SaveCallbackInput): Promise<SaveCallbackResult> {
    const existing =
      await this.ctx.storage.get<StoredCallback>(CALLBACK_RECORD_KEY);

    if (existing) {
      return { status: "already_saved", callback: existing };
    }

    const callback: StoredCallback = {
      callback_id: input.callbackId,
      name: input.name,
      phone: input.phone,
      created_at: input.createdAt,
    };

    await this.ctx.storage.put(CALLBACK_RECORD_KEY, callback);
    return { status: "saved", callback };
  }

  async getCallback(): Promise<StoredCallback | null> {
    return (
      (await this.ctx.storage.get<StoredCallback>(CALLBACK_RECORD_KEY)) ?? null
    );
  }
}
