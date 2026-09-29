import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type {
  AssetDomainDto,
  AutomationRuleCategory,
  AutomationRuleType,
  RuleCategoryDto,
  RuleExecutionItem,
  RuleListItem,
} from "@bms/shared";

import {
  archiveRule,
  duplicateRule,
  evaluateRules,
  fetchRuleExecutions,
  fetchRules,
  setRuleEnabled,
} from "../api/rules";
import { fetchVocabularies, vocabulariesQueryKey } from "../api/vocabularies";
import { labelFor, toneClass, toneFor } from "../lib/vocabulary";
import { EvaluateRefusalNotice } from "./evaluate-refusal-notice";
import { RuleBuilderPanel } from "./rule-builder-panel";
import { RuleChannelsEditor } from "./rule-channels-editor";

type RuleFilter = AutomationRuleCategory | "all";
type StatusFilter = "all" | "enabled" | "disabled";
type LifecycleFilter = "all" | "draft" | "published" | "archived";

/**
 * Both vocabularies are fetched, not declared (ADR 0031 Amendment 1). The badge
 * label, the badge styling and the filter dropdown all read the same
 * `vocabularies` query, so they cannot disagree about what a category is
 * called — which is what the old shared `categoryLabels` record bought, kept
 * now by having one source rather than one type.
 *
 * `categoryStyle` used to live here as an exhaustive `switch` over the category
 * union, and its comment said to keep it exhaustive because `F4.43` was exactly
 * what a non-exhaustive one did: `electrical` returned `undefined` and 48 of 89
 * rules rendered with the literal class `"undefined"`.
 *
 * With the vocabulary open, that `switch` **could not** be exhaustive — so the
 * styling moved to `toneClass` in `lib/vocabulary.ts`, which switches over
 * **tone** instead. Tone is a closed set pinned by `rule_categories_tone_check`,
 * so exhaustiveness is preserved where it can actually hold, and a newly seeded
 * category arrives already styled.
 */

const ruleTypeLabels: Record<AutomationRuleType, string> = {
  threshold: "Threshold",
  time_window: "Time window",
};

function statusStyle(item: RuleExecutionItem): string {
  switch (item.status) {
    case "matched":
      return "border-accent/20 bg-accent/10 text-accent-strong";
    case "not_matched":
      return "border-line bg-well-deep text-neutral-ink";
    case "skipped":
      return "border-warning-line bg-warning-wash-strong text-warning-ink";
    case "error":
      return "border-critical-line bg-critical-wash-strong text-critical-ink-strong";
  }
}

function lifecycleStyle(rule: RuleListItem): string {
  if (rule.lifecycleStatus === "draft") {
    return "border-warning-line bg-warning-wash text-warning-ink";
  }
  if (rule.lifecycleStatus === "archived") {
    return "border-line-strong bg-well-deep text-neutral-ink";
  }
  if (rule.enabled) {
    return "border-accent/20 bg-accent/10 text-accent-strong";
  }
  return "border-line bg-well text-ink-muted";
}

function ruleSummary(rule: RuleListItem): string {
  if (rule.ruleType === "threshold") {
    return `${rule.assetCode ?? "Asset"} · ${rule.pointKey ?? "point"} ${
      rule.operator ?? ""
    } ${rule.thresholdValue ?? ""}`.trim();
  }
  if ("days" in rule.condition) {
    return `${rule.condition.days.join(", ")} · ${rule.condition.startTime}-${rule.condition.endTime}`;
  }
  return "Trace-only rule";
}

function formatTime(value: string | null): string {
  if (!value) {
    return "Not evaluated";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Shows Sprint D rules, toggles, manual evaluation, and recent traces. */
export function RulesPanel() {
  const qc = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<RuleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>("all");
  const [selectedRule, setSelectedRule] = useState<RuleListItem | null>(null);

  const rulesQ = useQuery({
    queryKey: ["rules", "list"],
    queryFn: fetchRules,
  });
  const executionsQ = useQuery({
    queryKey: ["rules", "executions"],
    queryFn: () => fetchRuleExecutions(25),
  });
  // ADR 0031 Amendment 1 — labels, badge tones and the filter list all come
  // from here. `staleTime` is generous because these are reference rows that
  // change when a domain pack ships, not while an operator is working.
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    staleTime: 5 * 60 * 1000,
  });
  const ruleCategories = vocabQ.data?.ruleCategories;
  const assetDomains = vocabQ.data?.assetDomains;

  const toggleM = useMutation({
    mutationFn: setRuleEnabled,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rules", "list"] });
    },
  });

  const evaluateM = useMutation({
    mutationFn: evaluateRules,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rules", "list"] });
      void qc.invalidateQueries({ queryKey: ["rules", "executions"] });
    },
  });

  const duplicateM = useMutation({
    mutationFn: duplicateRule,
    onSuccess: (rule) => {
      setSelectedRule(rule);
      void qc.invalidateQueries({ queryKey: ["rules", "list"] });
    },
  });

  const archiveM = useMutation({
    mutationFn: archiveRule,
    onSuccess: () => {
      setSelectedRule(null);
      void qc.invalidateQueries({ queryKey: ["rules", "list"] });
    },
  });

  const rules = rulesQ.data?.items ?? [];
  const activeCount = rules.filter(
    (rule) => rule.enabled && rule.lifecycleStatus === "published",
  ).length;
  const draftCount = rules.filter((rule) => rule.lifecycleStatus === "draft").length;
  const archivedCount = rules.filter((rule) => rule.lifecycleStatus === "archived").length;
  const thresholdCount = rules.filter((rule) => rule.ruleType === "threshold").length;
  const timeWindowCount = rules.length - thresholdCount;

  const filteredRules = useMemo(
    () =>
      rules.filter((rule) => {
        const categoryMatch =
          categoryFilter === "all" || rule.category === categoryFilter;
        const statusMatch =
          statusFilter === "all" ||
          (statusFilter === "enabled" ? rule.enabled : !rule.enabled);
        const lifecycleMatch =
          lifecycleFilter === "all" || rule.lifecycleStatus === lifecycleFilter;
        return categoryMatch && statusMatch && lifecycleMatch;
      }),
    [categoryFilter, lifecycleFilter, rules, statusFilter],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Active Rules" value={`${activeCount}/${rules.length}`} />
          <Kpi label="Drafts" value={String(draftCount)} />
          <Kpi label="Archived" value={String(archivedCount)} />
          <Kpi label="Rule Types" value={`${thresholdCount}/${timeWindowCount}`} />
        </div>

        <div className="surface-raised">
          <div className="flex flex-col gap-3 border-b border-line px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-condensed text-lg font-bold text-ink">
                Active Rules ({activeCount}/{rules.length})
              </h2>
              <p className="text-xs text-ink-muted">
                Simple threshold and time-window rules; simulator alarm
                thresholds remain separate.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="surface-field px-2 py-1 text-xs"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as RuleFilter)}
              >
                <option value="all">All categories</option>
                {(ruleCategories ?? []).map((category) => (
                  <option key={category.code} value={category.code}>
                    {category.label}
                  </option>
                ))}
              </select>
              <select
                className="surface-field px-2 py-1 text-xs"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                <option value="all">All statuses</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
              <select
                className="surface-field px-2 py-1 text-xs"
                value={lifecycleFilter}
                onChange={(e) =>
                  setLifecycleFilter(e.target.value as LifecycleFilter)
                }
              >
                <option value="all">All lifecycle states</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
              <button
                className="surface-button-primary bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:cursor-not-allowed disabled:bg-line-strong"
                disabled={evaluateM.isPending || activeCount === 0}
                aria-busy={evaluateM.isPending}
                onClick={() => evaluateM.mutate()}
              >
                {evaluateM.isPending ? "Evaluating..." : "Evaluate now"}
              </button>
            </div>
          </div>

          {/* `F3.47`: the sweep is bounded to one per 30 s per throttle bucket
              — the caller's organization when they hold one, and a stand-in
              bucket when they hold none — so this button can now be refused
              with 429. Not "per organization": a global admin and a grantless
              caller are keyed otherwise. Without this the mutation had no error
              surface at all and a refused press did nothing, silently, twice.
              Under the toolbar rather than inside its flex row so a long
              sentence does not reflow the filters. */}
          <EvaluateRefusalNotice error={evaluateM.error} />

          {rulesQ.isLoading ? (
            <p className="p-4 text-sm text-ink-muted">Loading rules...</p>
          ) : rulesQ.isError ? (
            <p className="p-4 text-sm text-critical-ink">Could not load rules.</p>
          ) : filteredRules.length === 0 ? (
            <p className="p-4 text-sm text-ink-muted">No rules match the filters.</p>
          ) : (
            <div className="divide-y divide-line">
              {filteredRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  pending={toggleM.isPending}
                  lifecyclePending={duplicateM.isPending || archiveM.isPending}
                  toggling={toggleM.isPending && toggleM.variables?.id === rule.id}
                  duplicating={duplicateM.isPending && duplicateM.variables?.id === rule.id}
                  archiving={archiveM.isPending && archiveM.variables?.id === rule.id}
                  ruleCategories={ruleCategories}
                  assetDomains={assetDomains}
                  onEdit={() => setSelectedRule(rule)}
                  onDuplicate={() =>
                    duplicateM.mutate({
                      id: rule.id,
                      reason: "Operator duplicated rule from Rule Engine",
                    })
                  }
                  onArchive={() =>
                    archiveM.mutate({
                      id: rule.id,
                      reason: "Operator archived rule from Rule Engine",
                    })
                  }
                  onToggle={() =>
                    toggleM.mutate({
                      id: rule.id,
                      enabled: !rule.enabled,
                      reason: rule.enabled
                        ? "Operator disabled Sprint D rule"
                        : "Operator enabled Sprint D rule",
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <aside className="space-y-4">
        <RuleBuilderPanel
          selectedRule={selectedRule}
          onClearSelected={() => setSelectedRule(null)}
        />
        <section className="surface-raised">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-condensed text-lg font-bold text-ink">
              Execution Log
            </h2>
            <p className="text-xs text-ink-muted">Most recent rule evaluations.</p>
          </div>
          {executionsQ.isLoading ? (
            <p className="p-4 text-sm text-ink-muted">Loading executions...</p>
          ) : executionsQ.isError ? (
            <p className="p-4 text-sm text-critical-ink">Could not load executions.</p>
          ) : (executionsQ.data?.items ?? []).length === 0 ? (
            <p className="p-4 text-sm text-ink-muted">
              No executions yet. Run Evaluate now to create a trace.
            </p>
          ) : (
            <div className="divide-y divide-line">
              {(executionsQ.data?.items ?? []).map((item) => (
                <ExecutionRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-raised-sm p-3">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 font-condensed text-2xl font-bold text-ink">
        {value}
      </div>
    </div>
  );
}

function RuleCard({
  rule,
  pending,
  lifecyclePending,
  toggling,
  duplicating,
  archiving,
  ruleCategories,
  assetDomains,
  onEdit,
  onDuplicate,
  onArchive,
  onToggle,
}: {
  rule: RuleListItem;
  pending: boolean;
  lifecyclePending: boolean;
  toggling: boolean;
  duplicating: boolean;
  archiving: boolean;
  ruleCategories: readonly RuleCategoryDto[] | undefined;
  assetDomains: readonly AssetDomainDto[] | undefined;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onToggle: () => void;
}) {
  const canToggle = rule.lifecycleStatus === "published";
  const canArchive = rule.lifecycleStatus !== "archived";
  // F4.168: `toggling`/`duplicating`/`archiving` each imply the panel-wide
  // flag they narrow, so the `|| …` below changes no button's disabled state
  // — it only gives the gate a token to find beside the name it names.
  const toggleBusy = pending || toggling;
  const duplicateBusy = lifecyclePending || duplicating;
  const archiveBusy = lifecyclePending || archiving;
  /**
   * `F3.7` — the picker is mounted only while it is open, and that is the
   * point of the state rather than a nicety. `RuleChannelsEditor` issues one
   * `GET /rules/:id/notifications` per mount, and 289 published rules are live
   * on this database.
   */
  const [channelsOpen, setChannelsOpen] = useState(false);
  return (
    <article className="flex items-start gap-3 px-4 py-3">
      <button
        className={`mt-1 h-5 w-10 rounded-full p-0.5 transition ${
          rule.enabled ? "bg-accent" : "bg-line-strong"
        }`}
        disabled={toggleBusy || !canToggle}
        onClick={onToggle}
        title={rule.enabled ? "Disable rule" : "Enable rule"}
        aria-label={toggling ? "Updating rule…" : rule.enabled ? "Disable rule" : "Enable rule"}
        aria-busy={toggling}
      >
        <span
          className={`block h-4 w-4 rounded-full ${rule.enabled ? "bg-on-accent" : "bg-on-dark"} transition ${
            rule.enabled ? "translate-x-5" : ""
          }`}
        />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-ink">{rule.name}</h3>
          <span
            className={`surface-pill rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass(
              toneFor(ruleCategories, rule.category),
            )}`}
          >
            {labelFor(ruleCategories, rule.category)}
          </span>
          {/*
            ADR 0031's second axis, beside the first. Null when the rule targets
            no asset — the domain is the asset's fact, so a rule without one has
            no domain to show rather than an unknown one.
          */}
          {rule.assetDomain ? (
            <span
              className="rounded-full border border-dashed border-ink-faint px-2 py-0.5 text-[11px] text-ink-muted"
              title="Plant domain, from the asset this rule watches"
            >
              {labelFor(assetDomains, rule.assetDomain)}
            </span>
          ) : null}
          <span className="surface-pressed-sm rounded-full px-2 py-0.5 text-[11px] text-ink-muted">
            {ruleTypeLabels[rule.ruleType]}
          </span>
          <span
            className={`surface-pill rounded-full border px-2 py-0.5 text-[11px] font-semibold ${lifecycleStyle(
              rule,
            )}`}
          >
            {rule.lifecycleStatus}
            {rule.lifecycleStatus === "published"
              ? rule.enabled
                ? " · enabled"
                : " · disabled"
              : ""}
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-muted">{rule.description}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink-muted">
          <span className="surface-pressed-sm px-2 py-1">{ruleSummary(rule)}</span>
          <span className="surface-pressed-sm px-2 py-1">
            Last run: {formatTime(rule.lastEvaluatedAt)}
          </span>
          <span className="surface-pressed-sm px-2 py-1">
            Action: {rule.action.type} · {rule.action.target}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="surface-button px-2 py-1"
            onClick={onEdit}
          >
            Edit in builder
          </button>
          <button
            className="surface-button px-2 py-1"
            onClick={() => setChannelsOpen((open) => !open)}
          >
            Channels
          </button>
          <button
            className="surface-button px-2 py-1 disabled:opacity-50"
            disabled={duplicateBusy}
            aria-busy={duplicating}
            onClick={onDuplicate}
          >
            {duplicating ? "Duplicating…" : "Duplicate"}
          </button>
          <button
            className="surface-button px-2 py-1 text-critical-ink disabled:opacity-50"
            disabled={archiveBusy || !canArchive}
            aria-busy={archiving}
            onClick={onArchive}
          >
            {archiving ? "Archiving…" : "Archive"}
          </button>
        </div>
        {channelsOpen ? <RuleChannelsEditor ruleId={rule.id} action={rule.action} /> : null}
      </div>
    </article>
  );
}

function ExecutionRow({ item }: { item: RuleExecutionItem }) {
  return (
    <article className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">{item.ruleName}</h3>
          <p className="mt-0.5 text-xs text-ink-muted">{formatTime(item.evaluatedAt)}</p>
        </div>
        <span
          className={`surface-pill rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusStyle(
            item,
          )}`}
        >
          {item.status.replace("_", " ")}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-muted">{item.message}</p>
      {item.trace ? (
        <pre className="mt-2 max-h-28 overflow-auto rounded bg-chrome p-2 text-[11px] text-on-dark">
          {JSON.stringify(item.trace, null, 2)}
        </pre>
      ) : null}
    </article>
  );
}
