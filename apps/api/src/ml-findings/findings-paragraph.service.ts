import { Inject, Injectable, Logger } from "@nestjs/common";

import type { BmsDb } from "@bms/db";
import type { MlFindingsKind, MlFindingsParagraphCard, MlFindingsParagraphResponse } from "@bms/shared";

import { CopilotAvailabilityService } from "../copilot/copilot-availability.service";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { errorFacts } from "../llm/agent-loop";
import type { LlmProvider } from "../llm/llm-port";
import { LlmResolver } from "../llm/llm-resolver";
import type { FindingsCardFacts } from "../ml/ml-findings.lines";
import { MlFindingsService } from "../ml/ml-findings.service";
import { checkFindingsParagraph } from "./findings-paragraph.guard";
import {
  findingsParagraphStore,
  startOfUtcDay,
  type ParagraphOutcome,
  type StoredParagraph,
} from "./findings-paragraph.store";
import { buildFindingsPrompt } from "./findings-prompt";
import { pseudonymiseFacts, restoreParagraph, type PseudonymisedFacts } from "./findings-pseudonymise";

/** Decision 5: the provider must answer within this, or the attempt is `failed` / `timeout`. */
export const FINDINGS_CALL_TIMEOUT_MS = 15_000;
/** Decision 7: a `failed` row is tried again once it is this old. */
export const FINDINGS_FAILED_RETRY_MS = 30 * 60_000;
/** Decision 7: each write deletes the organization's rows older than this. */
export const FINDINGS_RETENTION_MS = 14 * 24 * 3_600_000;
/** Decision 11 (Q4): provider calls per organization per UTC day; `sum(attempts)` (owner ruling Q3 (a)). */
export const FINDINGS_DAILY_ATTEMPT_CAP = 200;
/** Plan R-n: provider calls in flight in this API process. */
export const FINDINGS_MAX_CALLS_IN_FLIGHT = 4;
/** Owner ruling Q2 (b): the output-token limit of this call only. */
export const FINDINGS_MAX_OUTPUT_TOKENS = 4_000;

type ReadyLlm = { readonly provider: LlmProvider; readonly model: string };

/**
 * `E1.9c` / ADR 0135 Amendment 8 decisions 4–7 and 11 (plan §4.5, R-m, R-n,
 * R-p) — the AI-written paragraph of each findings card, cached per
 * `(organization, kind, facts hash)`.
 *
 * Per card: the facts are computed again for the caller (never a hash from the
 * browser); a card with nothing to say, or with text that may not leave the
 * host, is `none`. With the organization's copilot switch off, or the
 * organization inactive, everything is `none` — a cached paragraph and a key
 * whose call is still running too. A cached `ok` row is served with the assets
 * its references name; a `rejected` row, a `failed` row younger than 30
 * minutes, or a key whose outcome could not be stored in the last 30 minutes,
 * is `none`. Otherwise — and only when `resolveForFindings` is ready and the
 * day's attempts (stored, plus this process's lost writes) are under 200 — one
 * call starts in the background and the answer is `pending`. No gate writes a
 * row (R-m), and none answers `pending`.
 *
 * **The route never waits for the provider** (R-n): at most one call per key
 * (checked and set with no await between, after the gates, so two concurrent
 * readers cannot both start one) and at most 4 calls in this process. The
 * background call catches everything; nothing it throws reaches a request.
 * Residual risk, accepted (security re-review L-d): the cap is read before a
 * call starts, so it can be overshot by at most the 4 calls in flight per API
 * process, and when writes keep failing each process (api, api-replica) counts
 * its lost attempts alone, so the bound is the cap per process.
 *
 * **Every table access runs in `withTenant(this.tenantDb, <the card's
 * organization>, …)`**, a global admin's too, so each row lands in and is read
 * from that organization alone. Each prompt holds one organization's facts.
 * The one log line holds the reason, the kind and the organization id — never
 * the facts, the prompt, the reply or a provider's error message (§9.6).
 */
@Injectable()
export class FindingsParagraphService {
  private readonly logger = new Logger(FindingsParagraphService.name);

  /** Replaced in specs by an in-memory fake; production uses the Drizzle store. */
  store = findingsParagraphStore;

  /** The calls running now, by key (single-flight), so a spec can wait for them to settle. */
  private readonly running = new Map<string, Promise<void>>();
  /** Review item 1(b): when each key's outcome last failed to be stored (back-off, 30 minutes). */
  private readonly lostWriteAt = new Map<string, number>();
  /** Review item 1(b): per organization, the calls today whose rows were lost; added to the stored sum. */
  private readonly lostAttempts = new Map<string, { day: number; count: number }>();

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly findings: MlFindingsService,
    private readonly llm: LlmResolver,
    private readonly availability: CopilotAvailabilityService,
  ) {}

  /** `GET /ml/findings/paragraph`: one state per card of the caller's facts, in the facts' order. */
  async get(
    kind: MlFindingsKind,
    assetIds: string[] | null,
    narrowed: boolean,
    now: Date,
  ): Promise<MlFindingsParagraphResponse> {
    const facts =
      kind === "forecasts"
        ? await this.findings.forecastFacts(assetIds, narrowed, now)
        : await this.findings.anomalyFacts(assetIds, now);
    const cards: MlFindingsParagraphCard[] = [];
    for (const card of facts.cards) {
      cards.push(await this.cardState(kind, card, now));
    }
    return { cards };
  }

  /** Resolves once every call running now has settled and been stored. For specs and the integration suite. */
  async settled(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.all([...this.running.values()]);
    }
  }

  private async cardState(kind: MlFindingsKind, card: FindingsCardFacts, now: Date): Promise<MlFindingsParagraphCard> {
    const organizationId = card.organizationId;
    const none: MlFindingsParagraphCard = { organizationId, state: "none", segments: [], assets: [] };
    const pending: MlFindingsParagraphCard = { organizationId, state: "pending", segments: [], assets: [] };
    const facts = pseudonymiseFacts(kind, card);
    if (!facts.sendable) return none;
    // Review items 7, re-review 4 and 5: the switch is the consent and an inactive organization gets
    // nothing — checked first, before a cached paragraph or a running call can answer.
    if (!(await this.availability.organizationSwitchOn(organizationId))) return none;
    if (!(await this.llm.isOrganizationActive(organizationId))) return none;
    const key = `${organizationId}\u0000${kind}\u0000${facts.hash}`;
    if (this.running.has(key)) return pending;

    const row = await withTenant(this.tenantDb, organizationId, (tx) =>
      this.store.readParagraph(tx, organizationId, kind, facts.hash),
    );
    if (row !== null) {
      if (row.status === "ok" && row.paragraph !== null) {
        const segments = restoreParagraph(row.paragraph, facts);
        const refs = new Set(segments.flatMap((s) => ("assetRef" in s ? [s.assetRef] : [])));
        return { organizationId, state: "ok", segments, assets: card.assets.filter((a) => refs.has(a.ref)) };
      }
      if (row.status !== "failed") return none;
      if (now.getTime() - row.createdAt.getTime() < FINDINGS_FAILED_RETRY_MS) return none;
    }
    // Review item 1(b): a key whose last outcome could not be stored waits as a failed row would.
    const lost = this.lostWriteAt.get(key);
    if (lost !== undefined && now.getTime() - lost < FINDINGS_FAILED_RETRY_MS) return none;

    // The gates run before anything is reserved, so a request that will make no call never answers pending.
    const resolved = await this.llm.resolveForFindings(organizationId);
    if (resolved.kind !== "ready") return none;
    const stored = await withTenant(this.tenantDb, organizationId, (tx) =>
      this.store.attemptsToday(tx, organizationId, now),
    );
    if (stored + this.lostAttemptsToday(organizationId, now) >= FINDINGS_DAILY_ATTEMPT_CAP) return none;

    // From here to `set` is synchronous: two readers that both passed the gates start one call.
    if (this.running.has(key)) return pending;
    if (this.running.size >= FINDINGS_MAX_CALLS_IN_FLIGHT) return pending;
    const call = this.call(kind, organizationId, facts, resolved, row, key)
      .catch(() => undefined)
      .finally(() => this.running.delete(key));
    this.running.set(key, call);
    return pending;
  }

  /** Attempts of `organizationId` today whose rows could not be stored (in this process). */
  private lostAttemptsToday(organizationId: string, now: Date): number {
    const entry = this.lostAttempts.get(organizationId);
    return entry !== undefined && entry.day === startOfUtcDay(now).getTime() ? entry.count : 0;
  }

  /** Counts a call whose outcome was lost, so it still holds the cap and its key backs off for 30 minutes. */
  private recordLostWrite(organizationId: string, key: string, at: Date): void {
    this.lostWriteAt.set(key, at.getTime());
    const day = startOfUtcDay(at).getTime();
    const entry = this.lostAttempts.get(organizationId);
    this.lostAttempts.set(organizationId, { day, count: entry?.day === day ? entry.count + 1 : 1 });
    for (const [k, t] of this.lostWriteAt) {
      if (at.getTime() - t >= FINDINGS_FAILED_RETRY_MS) this.lostWriteAt.delete(k);
    }
  }

  /** One provider call, checked and stored. Never throws. */
  private async call(
    kind: MlFindingsKind,
    organizationId: string,
    facts: PseudonymisedFacts,
    llm: ReadyLlm,
    retryOf: StoredParagraph | null,
    key: string,
  ): Promise<void> {
    const outcome = await this.ask(kind, facts, llm.provider);
    const now = new Date();
    try {
      await withTenant(this.tenantDb, organizationId, (tx) =>
        this.store.writeOutcome(tx, {
          organizationId,
          kind,
          factsHash: facts.hash,
          outcome,
          provider: llm.provider.name,
          model: llm.model,
          retryOf: retryOf?.status === "failed" ? retryOf : null,
          now,
          retainAfter: new Date(now.getTime() - FINDINGS_RETENTION_MS),
        }),
      );
    } catch (error) {
      // The provider was called, so the attempt counts and the key backs off, stored or not.
      this.recordLostWrite(organizationId, key, now);
      this.logger.warn(
        { organizationId, kind, ...errorFacts(error) },
        "ml findings paragraph outcome could not be stored",
      );
      return;
    }
    this.logger.log({ organizationId, kind, reason: outcome.reason ?? "ok" }, "ml findings paragraph outcome");
  }

  /** The provider's answer as an outcome: the guard decides `ok` or `rejected`; a throw or the timeout is `failed`. */
  private async ask(kind: MlFindingsKind, facts: PseudonymisedFacts, provider: LlmProvider): Promise<ParagraphOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FINDINGS_CALL_TIMEOUT_MS);
    // A provider that ignores the signal still loses the race at 15 s.
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    aborted.catch(() => undefined);
    try {
      const reply = await Promise.race([
        provider.complete({
          messages: buildFindingsPrompt(
            kind,
            facts.lines.map((line) => line.text),
          ),
          tools: [],
          signal: controller.signal,
          maxOutputTokens: FINDINGS_MAX_OUTPUT_TOKENS,
        }),
        aborted,
      ]);
      if (reply.kind === "tool_calls") {
        return { status: "rejected", paragraph: null, reason: "tool_calls" };
      }
      const text = reply.text.trim();
      const verdict = checkFindingsParagraph(text, facts.lines);
      return verdict.ok
        ? { status: "ok", paragraph: text, reason: null }
        : { status: "rejected", paragraph: null, reason: verdict.reason };
    } catch (error) {
      return { status: "failed", paragraph: null, reason: controller.signal.aborted ? "timeout" : failedReason(error) };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Plan R-p: the HTTP status only, never the message. */
export function failedReason(error: unknown): "provider_auth" | "provider_quota" | "provider_error" {
  const status = errorFacts(error).errorStatus;
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 402 || status === 429) return "provider_quota";
  return "provider_error";
}
