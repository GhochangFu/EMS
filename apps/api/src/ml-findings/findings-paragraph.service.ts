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
import { findingsParagraphStore, type ParagraphOutcome, type StoredParagraph } from "./findings-paragraph.store";
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
 * host, is `none`. A cached `ok` row is served; a `rejected` row, or a `failed`
 * row younger than 30 minutes, is `none`. Otherwise — and only when the
 * organization's copilot switch is on, `resolveForFindings` is ready and the
 * day's attempts are under 200 — one call starts in the background and the
 * answer is `pending`. None of those three gates writes a row (R-m).
 *
 * **The route never waits for the provider** (R-n): at most one call per key
 * (`reserved`, taken before the first await so two concurrent readers cannot
 * both start one) and at most 4 calls in this process. The background call
 * catches everything; nothing it throws reaches a request.
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

  /** Keys with a call starting or running (single-flight). */
  private readonly reserved = new Set<string>();
  /** The calls running now, by key, so a spec can wait for them to settle. */
  private readonly running = new Map<string, Promise<void>>();

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
    const none: MlFindingsParagraphCard = { organizationId, state: "none", segments: [] };
    const pending: MlFindingsParagraphCard = { organizationId, state: "pending", segments: [] };
    const facts = pseudonymiseFacts(kind, card);
    if (!facts.sendable) return none;

    const row = await withTenant(this.tenantDb, organizationId, (tx) =>
      this.store.readParagraph(tx, organizationId, kind, facts.hash),
    );
    if (row !== null) {
      if (row.status === "ok" && row.paragraph !== null) {
        return { organizationId, state: "ok", segments: restoreParagraph(row.paragraph, facts) };
      }
      if (row.status !== "failed") return none;
      if (now.getTime() - row.createdAt.getTime() < FINDINGS_FAILED_RETRY_MS) return none;
    }

    const key = `${organizationId}\u0000${kind}\u0000${facts.hash}`;
    if (this.reserved.has(key)) return pending;
    this.reserved.add(key);
    let started = false;
    try {
      if (!(await this.availability.organizationSwitchOn(organizationId))) return none;
      const resolved = await this.llm.resolveForFindings(organizationId);
      if (resolved.kind !== "ready") return none;
      const used = await withTenant(this.tenantDb, organizationId, (tx) =>
        this.store.attemptsToday(tx, organizationId, now),
      );
      if (used >= FINDINGS_DAILY_ATTEMPT_CAP) return none;
      if (this.running.size >= FINDINGS_MAX_CALLS_IN_FLIGHT) return pending;
      const call = this.call(kind, organizationId, facts, resolved, row)
        .catch(() => undefined)
        .finally(() => {
          this.running.delete(key);
          this.reserved.delete(key);
        });
      this.running.set(key, call);
      started = true;
      return pending;
    } finally {
      if (!started) this.reserved.delete(key);
    }
  }

  /** One provider call, checked and stored. Never throws. */
  private async call(
    kind: MlFindingsKind,
    organizationId: string,
    facts: PseudonymisedFacts,
    llm: ReadyLlm,
    retryOf: StoredParagraph | null,
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
