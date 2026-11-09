import { StatefulActor } from "@telnyx/edge-runtime";

const MISUNDERSTANDING_COUNT_KEY = "misunderstanding_count";
export const ESCALATION_THRESHOLD = 3;

export interface MisunderstandingResult {
  count: number;
  shouldEscalate: boolean;
  newlyReachedThreshold: boolean;
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
}
