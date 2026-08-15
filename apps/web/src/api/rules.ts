import {
  ruleBuilderCatalogResponseSchema,
  ruleExecutionsResponseSchema,
  ruleListItemSchema,
  rulePreviewResultSchema,
  rulesResponseSchema,
} from "@bms/shared/contracts";
import type {
  AutomationRuleAction,
  AutomationRuleCategory,
  AutomationRuleCondition,
  AutomationRuleOperator,
  AutomationRuleType,
  RuleBuilderCatalogAsset,
  RuleExecutionItem,
  RuleListItem,
  RulePreviewResult,
} from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type RulesResponse = {
  items: RuleListItem[];
};

export type RuleExecutionsResponse = {
  items: RuleExecutionItem[];
};

export type RuleBuilderCatalogResponse = {
  assets: RuleBuilderCatalogAsset[];
};

export type RuleDraftPayload = {
  code?: string;
  name: string;
  description?: string | null;
  category: AutomationRuleCategory;
  ruleType: AutomationRuleType;
  assetId?: string | null;
  pointKey?: string | null;
  operator?: AutomationRuleOperator | null;
  thresholdValue?: number | null;
  severity?: "info" | "warning" | "critical" | null;
  condition: AutomationRuleCondition;
  action: AutomationRuleAction;
};

/** GET /api/v1/rules */
export async function fetchRules(): Promise<RulesResponse> {
  const res = await fetch(`${base}/api/v1/rules`, withAuth());
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`rules ${res.status}`);
  }
  return checkResponse(rulesResponseSchema, await res.json(), "rules");
}

/** GET /api/v1/rules/catalog */
export async function fetchRuleBuilderCatalog(): Promise<RuleBuilderCatalogResponse> {
  const res = await fetch(`${base}/api/v1/rules/catalog`, withAuth());
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`rule-catalog ${res.status}`);
  }
  return checkResponse(ruleBuilderCatalogResponseSchema, await res.json(), "rules/catalog");
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
  return checkResponse(ruleExecutionsResponseSchema, await res.json(), "rules/executions");
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
  return checkResponse(ruleListItemSchema, await res.json(), "rules/:id/enabled");
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
  return checkResponse(ruleExecutionsResponseSchema, await res.json(), "rules/evaluate");
}

/** POST /api/v1/rules */
export async function createRuleDraft(input: RuleDraftPayload): Promise<RuleListItem> {
  const res = await fetch(`${base}/api/v1/rules`, {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `rule-create ${res.status}`);
  }
  return checkResponse(ruleListItemSchema, await res.json(), "rules");
}

/** PATCH /api/v1/rules/:id */
export async function updateRuleDraft(input: {
  id: string;
  payload: Partial<RuleDraftPayload> & { reason?: string };
}): Promise<RuleListItem> {
  const res = await fetch(`${base}/api/v1/rules/${input.id}`, {
    ...withAuth({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.payload),
    }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `rule-update ${res.status}`);
  }
  return checkResponse(ruleListItemSchema, await res.json(), "rules/:id");
}

/** POST /api/v1/rules/preview */
export async function previewRuleDraft(
  input: RuleDraftPayload & { id?: string },
): Promise<RulePreviewResult> {
  const res = await fetch(`${base}/api/v1/rules/preview`, {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `rule-preview ${res.status}`);
  }
  return checkResponse(rulePreviewResultSchema, await res.json(), "rules/preview");
}

/** POST /api/v1/rules/:id/publish */
export async function publishRule(input: {
  id: string;
  reason?: string;
}): Promise<RuleListItem> {
  return ruleLifecycleRequest(input.id, "publish", input.reason);
}

/** POST /api/v1/rules/:id/duplicate */
export async function duplicateRule(input: {
  id: string;
  reason?: string;
}): Promise<RuleListItem> {
  return ruleLifecycleRequest(input.id, "duplicate", input.reason);
}

/** POST /api/v1/rules/:id/archive */
export async function archiveRule(input: {
  id: string;
  reason?: string;
}): Promise<RuleListItem> {
  return ruleLifecycleRequest(input.id, "archive", input.reason);
}

async function ruleLifecycleRequest(
  id: string,
  action: "publish" | "duplicate" | "archive",
  reason?: string,
): Promise<RuleListItem> {
  const res = await fetch(`${base}/api/v1/rules/${id}/${action}`, {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `rule-${action} ${res.status}`);
  }
  return checkResponse(ruleListItemSchema, await res.json(), "rules/:id/:action");
}
