import { dbBlindTo } from "../testing/blinded-db";
import type { ChannelsService } from "./channels.service";
import { buildDedupeKey } from "./dedupe-key";
import type { NotificationChannelRow, NotificationTransport } from "./notification-transport";
import { buildConfig } from "./notifications.config";
import { NotificationsService, type DispatchInput } from "./notifications.service";

/**
 * `F3.54` — a refused CLEARED message's row really lands, at both failed reads
 * (ADR 0057 Amendment 4 ruling 1).
 *
 * **Why this is its own file.** These blocks belong to `storm-control.
 * integration.spec.ts`'s fixture — the same channel, alarm and rule — and were
 * written there first. That file reached 1000 of AGENTS.md §4.5's cap, and §2's
 * standing instruction for a file at that margin is *extract before adding*.
 * So the fixture stays there and the assertions move here, invoked with a
 * context object; the wrapper that runs them is still
 * `storm-control.integration.test.ts`, and it still gates on `DATABASE_URL`.
 *
 * **What these hold that the unit spec cannot.** `notifications.events.spec.ts`
 * cases 6b and 10b hold that the insert is *attempted*. These hold that the row
 * reaches `bms.notification_deliveries` and reads back — against the real
 * status CHECK, the real `organization_id NOT NULL` and the real `alarm_id`
 * foreign key, none of which a fake has.
 *
 * **The read failure is synthesised, and §4.6 asks that the substitution be
 * said where the test is written.** Both exits fire only when a read throws,
 * and inducing that against this database means revoking a grant or terminating
 * a backend on a role other suites are using. `dbBlindTo` rejects exactly one
 * `select` projection and delegates everything else — the INSERT included — to
 * the real database, so the write path under test is never simulated. Its
 * header carries why that is sound, and `blindedReads()` gates the premise
 * rather than asserting it in prose.
 *
 * Each block asserts BOTH kinds. The escalation half kills the over-broad
 * mutation "record on every event" — but only under its own key, so
 * `notifications.events.spec.ts` cases 6 and 10, which assert
 * `recorded.length === 0` outright, stay the key-independent holders of that
 * claim. Do not delete them believing this file covers it.
 */
export type ClearedRefusalContext = {
  db: ConstructorParameters<typeof NotificationsService>[0];
  channels: ChannelsService;
  transport: NotificationTransport;
  /** The suite's send log, so a block can assert a refusal reached no transport. */
  sent: readonly unknown[];
  /** The enabled fixture channel, already through `toChannelRow`. */
  channel: NotificationChannelRow;
  /** The fixture dispatch — a real rule, organization and alarm. */
  step: DispatchInput;
  /** The statuses under one key, oldest first. */
  statusesByKey: (dedupeKey: string) => Promise<string[]>;
  assert: (condition: boolean, message: string) => void;
};

export async function runClearedRefusalRowTests(ctx: ClearedRefusalContext): Promise<void> {
  const { assert, statusesByKey } = ctx;

  const blindService = (
    blindedShape: string,
  ): { service: NotificationsService; blindedReads: () => number } => {
    const blind = dbBlindTo(ctx.db, blindedShape);
    type Deps = ConstructorParameters<typeof NotificationsService>;
    return {
      service: new NotificationsService(
        blind.db,
        ctx.channels,
        ctx.transport as unknown as Deps[2],
        ctx.transport as unknown as Deps[3],
        ctx.transport as unknown as Deps[4],
        buildConfig({ NOTIFY_RATE_LIMIT_PER_HOUR: "1000" }),
      ),
      blindedReads: blind.blindedReads,
    };
  };

  // Distinct severities: the key is `rule:alarm:severity[:suffix]`, and the
  // storm-control fixture already owns the `warning` and `critical` clears.

  // --- D3: blind `{ status }`, so only `eventDeliveryBlocked` throws --------
  {
    const d3 = blindService("status");
    const clear: DispatchInput = { ...ctx.step, severity: "major", event: { kind: "cleared" } };
    const escalation: DispatchInput = { ...clear, event: { kind: "escalation", step: 20 } };
    const sentBefore = ctx.sent.length;

    const clearResult = await d3.service.dispatchToChannels([ctx.channel], clear);
    const stepResult = await d3.service.dispatchToChannels([ctx.channel], escalation);

    assert(
      clearResult[0]?.status === "failed" && stepResult[0]?.status === "failed",
      `an unreadable ledger fails both kinds, got ${String(clearResult[0]?.status)}/${String(
        stepResult[0]?.status,
      )}`,
    );
    // The premise, gated: exactly one read was blinded per dispatch. A fifth
    // `select({ status })` in the service would blind two and quietly change
    // what everything below is proving.
    assert(
      d3.blindedReads() === 2,
      `two dispatches must blind exactly one read each, got ${d3.blindedReads()}`,
    );
    assert(ctx.sent.length === sentBefore, "a failed ledger read is never a send, either kind");
    assert(
      (await statusesByKey(buildDedupeKey(clear))).join(",") === "failed",
      "F3.54 D3: the cleared message's refusal row is in Postgres",
    );
    assert(
      (await statusesByKey(buildDedupeKey(escalation))).length === 0,
      "F3.54 D3: the escalation step still writes nothing — its key survives for the next tick",
    );
  }

  // --- H1: blind `{ count }`, so the ledger read runs for real and only ----
  //     `isOverHourlyLimit` throws. The key is fresh, so the real read does
  //     not block, and step 2 is reached.
  {
    const h1 = blindService("count");
    const clear: DispatchInput = { ...ctx.step, severity: "minor", event: { kind: "cleared" } };
    const escalation: DispatchInput = { ...clear, event: { kind: "escalation", step: 21 } };
    const sentBefore = ctx.sent.length;

    const clearResult = await h1.service.dispatchToChannels([ctx.channel], clear);
    const stepResult = await h1.service.dispatchToChannels([ctx.channel], escalation);

    assert(
      clearResult[0]?.error === "rate-limit check failed" &&
        stepResult[0]?.error === "rate-limit check failed",
      `an unreadable ceiling fails both kinds by name, got ${JSON.stringify([
        clearResult[0],
        stepResult[0],
      ])}`,
    );
    assert(
      h1.blindedReads() === 2,
      `two dispatches must blind exactly one read each, got ${h1.blindedReads()}`,
    );
    assert(ctx.sent.length === sentBefore, "an unreadable ceiling is not a licence to send");
    assert(
      (await statusesByKey(buildDedupeKey(clear))).join(",") === "failed",
      "F3.54 H1: the cleared message's refusal row is in Postgres",
    );
    assert(
      (await statusesByKey(buildDedupeKey(escalation))).length === 0,
      "F3.54 H1: the escalation step still writes nothing",
    );
  }
}
