import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type {
  AutomationRuleCategory,
  AutomationRuleType,
  RuleExecutionItem,
  RuleListItem,
} from "@bms/shared";

import {
  evaluateRules,
  fetchRuleExecutions,
  fetchRules,
  setRuleEnabled,
} from "../api/rules";

type RuleFilter = AutomationRuleCategory | "all";
type StatusFilter = "all" | "enabled" | "disabled";

const categoryLabels: Record<AutomationRuleCategory, string> = {
  comfort: "Comfort",
  energy: "Energy",
  safety: "Safety",
  operations: "Operations",
};

const ruleTypeLabels: Record<AutomationRuleType, string> = {
  threshold: "Threshold",
  time_window: "Time window",
};

function categoryStyle(category: AutomationRuleCategory): string {
  switch (category) {
    case "safety":
      return "border-red-200 bg-red-50 text-red-700";
    case "energy":
      return "border-bms-green/20 bg-bms-green/10 text-bms-green";
    case "comfort":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "operations":
      return "border-gray-200 bg-white text-bms-muted";
  }
}

function statusStyle(item: RuleExecutionItem): string {
  switch (item.status) {
    case "matched":
      return "border-bms-green/20 bg-bms-green/10 text-bms-green";
    case "not_matched":
      return "border-gray-200 bg-gray-100 text-gray-700";
    case "skipped":
      return "border-amber-200 bg-amber-100 text-amber-900";
    case "error":
      return "border-red-200 bg-red-100 text-red-800";
  }
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

  const rulesQ = useQuery({
    queryKey: ["rules", "list"],
    queryFn: fetchRules,
  });
  const executionsQ = useQuery({
    queryKey: ["rules", "executions"],
    queryFn: () => fetchRuleExecutions(25),
  });

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

  const rules = rulesQ.data?.items ?? [];
  const activeCount = rules.filter((rule) => rule.enabled).length;
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
        return categoryMatch && statusMatch;
      }),
    [categoryFilter, rules, statusFilter],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Active Rules" value={`${activeCount}/${rules.length}`} />
          <Kpi label="Threshold" value={String(thresholdCount)} />
          <Kpi label="Time Window" value={String(timeWindowCount)} />
          <Kpi label="Source" value="Operator rules" />
        </div>

        <div className="rounded border border-gray-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-condensed text-lg font-bold text-bms-ink">
                Active Rules ({activeCount}/{rules.length})
              </h2>
              <p className="text-xs text-bms-muted">
                Simple threshold and time-window rules; simulator alarm
                thresholds remain separate.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as RuleFilter)}
              >
                <option value="all">All categories</option>
                {Object.entries(categoryLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                <option value="all">All statuses</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
              <button
                className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                disabled={evaluateM.isPending || activeCount === 0}
                onClick={() => evaluateM.mutate()}
              >
                {evaluateM.isPending ? "Evaluating..." : "Evaluate now"}
              </button>
            </div>
          </div>

          {rulesQ.isLoading ? (
            <p className="p-4 text-sm text-bms-muted">Loading rules...</p>
          ) : rulesQ.isError ? (
            <p className="p-4 text-sm text-red-600">Could not load rules.</p>
          ) : filteredRules.length === 0 ? (
            <p className="p-4 text-sm text-bms-muted">No rules match the filters.</p>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  pending={toggleM.isPending}
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

      <aside className="rounded border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="font-condensed text-lg font-bold text-bms-ink">
            Execution Log
          </h2>
          <p className="text-xs text-bms-muted">Most recent rule evaluations.</p>
        </div>
        {executionsQ.isLoading ? (
          <p className="p-4 text-sm text-bms-muted">Loading executions...</p>
        ) : executionsQ.isError ? (
          <p className="p-4 text-sm text-red-600">Could not load executions.</p>
        ) : (executionsQ.data?.items ?? []).length === 0 ? (
          <p className="p-4 text-sm text-bms-muted">
            No executions yet. Run Evaluate now to create a trace.
          </p>
        ) : (
          <div className="divide-y divide-gray-200">
            {(executionsQ.data?.items ?? []).map((item) => (
              <ExecutionRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-200 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-bms-muted">{label}</div>
      <div className="mt-1 font-condensed text-2xl font-bold text-bms-ink">
        {value}
      </div>
    </div>
  );
}

function RuleCard({
  rule,
  pending,
  onToggle,
}: {
  rule: RuleListItem;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="flex items-start gap-3 px-4 py-3">
      <button
        className={`mt-1 h-5 w-10 rounded-full p-0.5 transition ${
          rule.enabled ? "bg-bms-green" : "bg-gray-300"
        }`}
        disabled={pending}
        onClick={onToggle}
        title={rule.enabled ? "Disable rule" : "Enable rule"}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-white transition ${
            rule.enabled ? "translate-x-5" : ""
          }`}
        />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-bms-ink">{rule.name}</h3>
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${categoryStyle(
              rule.category,
            )}`}
          >
            {categoryLabels[rule.category]}
          </span>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-bms-muted">
            {ruleTypeLabels[rule.ruleType]}
          </span>
        </div>
        <p className="mt-1 text-sm text-bms-muted">{rule.description}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-bms-muted">
          <span className="rounded bg-gray-100 px-2 py-1">{ruleSummary(rule)}</span>
          <span className="rounded bg-gray-100 px-2 py-1">
            Last run: {formatTime(rule.lastEvaluatedAt)}
          </span>
          <span className="rounded bg-gray-100 px-2 py-1">
            Action: {rule.action.type} · {rule.action.target}
          </span>
        </div>
      </div>
    </article>
  );
}

function ExecutionRow({ item }: { item: RuleExecutionItem }) {
  return (
    <article className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-bms-ink">{item.ruleName}</h3>
          <p className="mt-0.5 text-xs text-bms-muted">{formatTime(item.evaluatedAt)}</p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusStyle(
            item,
          )}`}
        >
          {item.status.replace("_", " ")}
        </span>
      </div>
      <p className="mt-2 text-sm text-bms-muted">{item.message}</p>
      {item.trace ? (
        <pre className="mt-2 max-h-28 overflow-auto rounded bg-gray-950 p-2 text-[11px] text-gray-100">
          {JSON.stringify(item.trace, null, 2)}
        </pre>
      ) : null}
    </article>
  );
}
