import type { RuleExecutionItem, RuleListItem } from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type RulesResponse = {
  items: RuleListItem[];
};

export type RuleExecutionsResponse = {
  items: RuleExecutionItem[];
};

/** GET /api/v1/rules */
export async function fetchRules(): Promise<RulesResponse> {
  const res = await fetch(`${base}/api/v1/rules`, withAuth());
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`rules ${res.status}`);
  }
  return res.json() as Promise<RulesResponse>;
}

/** GET /api/v1/rules/executions */
export async function fetchRuleExecutions(
  limit = 25,
): Promise<RuleExecutionsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`${base}/api/v1/rules/executions?${params}`, withAuth());
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`rule-executions ${res.status}`);
  }
  return res.json() as Promise<RuleExecutionsResponse>;
}

/** PATCH /api/v1/rules/:id/enabled */
export async function setRuleEnabled(input: {
  id: string;
  enabled: boolean;
  reason?: string;
}): Promise<RuleListItem> {
  const res = await fetch(`${base}/api/v1/rules/${input.id}/enabled`, {
    ...withAuth({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: input.enabled,
        reason: input.reason,
      }),
    }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `rule-toggle ${res.status}`);
  }
  return res.json() as Promise<RuleListItem>;
}

/** POST /api/v1/rules/evaluate */
export async function evaluateRules(): Promise<RuleExecutionsResponse> {
  const res = await fetch(`${base}/api/v1/rules/evaluate`, {
    ...withAuth({ method: "POST" }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `rule-evaluate ${res.status}`);
  }
  return res.json() as Promise<RuleExecutionsResponse>;
}
