import type { AdapterLogger } from "../adapter/types.js";
import type { PlanWarning, SkippedBinding } from "./bindings.js";

/**
 * Once per key per process (`F1.2` plan T3.7, ADR 0016 Amendment 10 (a)).
 *
 * `main.ts` reports a plan warning at boot and at every reload. An unchanged
 * warning must not be repeated every `INGEST_RELOAD_MS` — a line per RTU per
 * cycle is how a real signal gets buried — but a new one, including one that
 * first appears at a reload, is reported the first time this process sees it
 * (ADR 0062 decision 9 and its 2026-09-11 security review). This was an
 * untested `Set` inline in `main.ts`; it is a tested module now.
 */

/** A predicate that answers `true` the first time it sees a key, `false` after. */
export function oncePerKey(): (key: string) => boolean {
  const seen = new Set<string>();
  return (key) => {
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  };
}

/**
 * Logs each `(reason, detail, rtuId)` once per process. A poll interval
 * warning names the level that was replaced (`endpoint` or `organization`),
 * never the stored value.
 */
export function createPlanWarningReporter(logger: AdapterLogger): (warnings: readonly PlanWarning[]) => void {
  const first = oncePerKey();
  return (warnings) => {
    for (const warning of warnings) {
      if (!first(`${warning.reason}\u0000${warning.detail ?? ""}\u0000${warning.rtuId}`)) {
        continue;
      }
      switch (warning.reason) {
        case "poll-interval-out-of-bounds":
          logger.warn("rtu poll interval out of bounds", {
            rtuCode: warning.rtuCode,
            rtuId: warning.rtuId,
            reason: warning.reason,
            level: warning.detail,
          });
          break;
        case "credential-env-fallback":
          logger.warn("rtu credential fallback", {
            rtuCode: warning.rtuCode,
            rtuId: warning.rtuId,
            reason: warning.reason,
          });
          break;
        default: {
          // A new reason must choose its own line, never borrow another's.
          const unhandled: never = warning.reason;
          void unhandled;
        }
      }
    }
  };
}

/**
 * Skips first seen at a **reload**, for the reasons named (ADR 0141 decision
 * 22: `modbus-host-not-allowed`). `main.ts` logs every boot-time skip itself;
 * `boot` only marks those, so a reload never repeats them, and `reload` logs a
 * named reason the first time an RTU reaches it. Other reasons keep today's
 * boot-only line (the health body still lists them).
 */
export function createReloadSkipReporter(
  logger: AdapterLogger,
  reasons: ReadonlySet<string>,
): { boot(skips: readonly SkippedBinding[]): void; reload(skips: readonly SkippedBinding[]): void } {
  const first = oncePerKey();
  const key = (skip: SkippedBinding) => `${skip.reason}\u0000${skip.rtuId}`;
  return {
    boot(skips) {
      for (const skip of skips) {
        if (reasons.has(skip.reason)) first(key(skip));
      }
    },
    reload(skips) {
      for (const skip of skips) {
        if (reasons.has(skip.reason) && first(key(skip))) {
          logger.warn("rtu skipped", { rtuCode: skip.rtuCode, rtuId: skip.rtuId, reason: skip.reason });
        }
      }
    },
  };
}
