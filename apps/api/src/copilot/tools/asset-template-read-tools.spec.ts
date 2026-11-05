import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { AdminAssetTemplateSummaryDto, AssetTemplateStatus, JwtPayload } from "@bms/shared";

import type { ResolvedIdentity } from "../../auth/identity-resolver";
import { succeed } from "../../llm/tool-result";
import { scrubToolResult } from "../copilot-secret-scrub";
import type { CopilotToolContext } from "../copilot-read-tools";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { COPILOT_ASSET_TEMPLATES_REFUSAL } from "./list-asset-templates.tool";

/**
 * `F4.315` PR A (ADR 0099 Amendment 14 decision 1, ruling Q1; plan task A2) —
 * `list_asset_templates` over a fake `AssetTemplatesAdminService.list` that
 * logs its calls: the admin list's own read, once per allowed organization,
 * `published` unless the model asks another status; an organization the caller
 * may not manage (the list's own 403) is skipped; `code` is exact or prefix,
 * case-insensitive, and `domain` exact; each row is the eight fields the
 * Amendment names, by organization, code, then version newest first.
 *
 * Mutations, each applied once and seen red: drop the default status
 * ({@link theDefaultStatusIsPublished}); drop the 403 catch
 * ({@link aForbiddenOrganizationIsSkipped}); return the raw summary row
 * ({@link aRowIsTheEightFields}); answer the empty list when every organization
 * is forbidden ({@link everyOrganizationForbiddenIsARefusal}); name every read
 * organization rather than the kept rows' ({@link aCutOrganizationIsNotNamed}).
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000bb";

function ctx(allowed: string[] = [ORG_A]): CopilotToolContext {
  return {
    identity: { id: USER, role: "organization_admin", organizationId: ORG_A } as ResolvedIdentity,
    user: { sub: USER, role: "organization_admin" } as JwtPayload,
    conversationId: "22222222-2222-4222-8222-222222222222",
    conversationOrganizationId: null,
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: new Date("2026-11-06T06:00:00Z"),
  };
}

let next = 0;
function template(organizationId: string, code: string, version = 1, over: Partial<AdminAssetTemplateSummaryDto> = {}): AdminAssetTemplateSummaryDto {
  next += 1;
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(next).padStart(12, "0")}`,
    organizationId,
    organizationCode: organizationId === ORG_A ? "ORGA" : "ORGB",
    organizationName: organizationId === ORG_A ? "Org A" : "Org B",
    code,
    version,
    name: `${code} v${version}`,
    assetType: "pump",
    domain: "water",
    description: "secret description",
    status: "published",
    content: { kpis: [] },
    publishedAt: "2026-11-01T00:00:00.000Z",
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    pointCount: 4,
    ...over,
  };
}

type Call = { organizationId: string | undefined; status: AssetTemplateStatus | undefined };

/** The service fake: each organization's rows, or a `ForbiddenException` (or any error) for one. */
function fake(byOrg: Record<string, AdminAssetTemplateSummaryDto[] | Error>) {
  const calls: Call[] = [];
  const services = {
    assetTemplates: {
      list: async (_user: JwtPayload, organizationId?: string, status?: AssetTemplateStatus) => {
        calls.push({ organizationId, status });
        const rows = byOrg[organizationId ?? ""] ?? [];
        if (rows instanceof Error) throw rows;
        return { items: rows };
      },
    },
  } as unknown as CopilotReadServices;
  return { tools: createCopilotReadTools(services), calls };
}

type Item = { code: string; version: number; organizationCode: string };
const itemsOf = (out: Awaited<ReturnType<ReturnType<typeof fake>["tools"]["dispatch"]>>): Item[] =>
  out.ok ? (out.result.items as Item[]) : [];

/** (i) With no `status`, the list asks the published versions only — the versions an adoption can name. */
export async function theDefaultStatusIsPublished(): Promise<void> {
  const { tools, calls } = fake({ [ORG_A]: [] });
  await tools.dispatch("list_asset_templates", {}, ctx());
  expect(calls).toEqual([{ organizationId: ORG_A, status: "published" }]);
}

/** (ii) A `status` the model sends is passed through to the list. */
export async function aStatusIsPassedThrough(): Promise<void> {
  const { tools, calls } = fake({ [ORG_A]: [] });
  await tools.dispatch("list_asset_templates", { status: "draft" }, ctx());
  expect(calls).toEqual([{ organizationId: ORG_A, status: "draft" }]);
}

/** (iii) `code` keeps an exact or prefix match, whatever the case, and drops the rest. */
export async function aCodeIsAnExactOrPrefixMatch(): Promise<void> {
  const { tools } = fake({ [ORG_A]: [template(ORG_A, "PUMP-M"), template(ORG_A, "pump-c"), template(ORG_A, "AIRSP")] });
  const out = await tools.dispatch("list_asset_templates", { code: "pump" }, ctx());
  expect(itemsOf(out).map((item) => item.code)).toEqual(["PUMP-M", "pump-c"]);
}

/** `domain` keeps an exact match only. */
export async function aDomainIsAnExactMatch(): Promise<void> {
  const { tools } = fake({ [ORG_A]: [template(ORG_A, "PUMP-M"), template(ORG_A, "AHU", 1, { domain: "hvac" })] });
  const out = await tools.dispatch("list_asset_templates", { domain: "hvac" }, ctx());
  expect(itemsOf(out).map((item) => item.code)).toEqual(["AHU"]);
}

/** (iv) An organization the caller may not manage (the list's own 403) is skipped: the other's rows, no error. */
export async function aForbiddenOrganizationIsSkipped(): Promise<void> {
  const { tools } = fake({ [ORG_A]: [template(ORG_A, "PUMP-M")], [ORG_B]: new ForbiddenException("Organization is outside your access scope") });
  const out = await tools.dispatch("list_asset_templates", {}, ctx([ORG_A, ORG_B]));
  expect([out.ok, itemsOf(out).map((item) => item.code)]).toEqual([true, ["PUMP-M"]]);
}

/** Every allowed organization forbidden (the list's 403, or `requireMasterDataUser`'s): a refusal, not an empty list. */
export async function everyOrganizationForbiddenIsARefusal(): Promise<void> {
  const forbidden = new ForbiddenException("Organization is outside your access scope");
  const { tools } = fake({ [ORG_A]: forbidden, [ORG_B]: forbidden });
  expect(await tools.dispatch("list_asset_templates", {}, ctx([ORG_A, ORG_B]))).toEqual({
    ok: false,
    error: COPILOT_ASSET_TEMPLATES_REFUSAL,
  });
}

/** The allowed twin: one readable organization with no versions is an empty list, not the refusal. */
export async function aReadableOrganizationWithNoVersionsIsAnEmptyList(): Promise<void> {
  const { tools } = fake({ [ORG_A]: [] });
  expect(await tools.dispatch("list_asset_templates", {}, ctx())).toEqual({
    ok: true,
    result: { truncated: false, items: [] },
    organizationIds: [],
  });
}

/** Any other error of the list is not swallowed: the call fails (the registry's generic failure). */
export async function anotherErrorIsRethrown(): Promise<void> {
  const { tools } = fake({ [ORG_A]: new Error("connection lost") });
  await expect(tools.dispatch("list_asset_templates", {}, ctx())).rejects.toThrow("connection lost");
}

/** (v) A row is exactly the eight fields: no description, no content, no point count. */
export async function aRowIsTheEightFields(): Promise<void> {
  const row = template(ORG_A, "PUMP-M", 2);
  const out = await fake({ [ORG_A]: [row] }).tools.dispatch("list_asset_templates", {}, ctx());
  expect(itemsOf(out)).toEqual([
    { id: row.id, code: "PUMP-M", version: 2, name: "PUMP-M v2", domain: "water", assetType: "pump", status: "published", organizationCode: "ORGA" },
  ]);
}

/** Rows are ordered by organization code, then code, then version newest first. */
export async function rowsAreOrderedByOrganizationCodeAndVersion(): Promise<void> {
  const { tools } = fake({
    [ORG_A]: [template(ORG_A, "PUMP-M", 1), template(ORG_A, "AHU", 1), template(ORG_A, "PUMP-M", 3)],
    [ORG_B]: [template(ORG_B, "AHU", 2)],
  });
  const out = await tools.dispatch("list_asset_templates", {}, ctx([ORG_B, ORG_A]));
  expect(itemsOf(out).map((item) => `${item.organizationCode}/${item.code}/${item.version}`)).toEqual([
    "ORGA/AHU/1",
    "ORGA/PUMP-M/3",
    "ORGA/PUMP-M/1",
    "ORGB/AHU/2",
  ]);
}

/** The result names the organizations whose rows it holds (the turn's provenance), and only those. */
export async function theResultNamesTheOrganizationsItHolds(): Promise<void> {
  const { tools } = fake({ [ORG_A]: [], [ORG_B]: [template(ORG_B, "AHU")] });
  const out = await tools.dispatch("list_asset_templates", {}, ctx([ORG_A, ORG_B]));
  expect(out.ok && out.organizationIds).toEqual([ORG_B]);
}

/** Organization B's rows sort last and are all cut by the budget: the result names organization A only. */
export async function aCutOrganizationIsNotNamed(): Promise<void> {
  const long = { name: "n".repeat(120) };
  const { tools } = fake({
    [ORG_A]: Array.from({ length: 200 }, (_, i) => template(ORG_A, `T${String(i).padStart(3, "0")}`, 1, long)),
    [ORG_B]: [template(ORG_B, "AHU", 1, long)],
  });
  const out = await tools.dispatch("list_asset_templates", {}, ctx([ORG_A, ORG_B]));
  expect(out.ok && [out.result.truncated, out.organizationIds]).toEqual([true, [ORG_A]]);
}

/** (vi) A list past the tool-result budget keeps what fits and says `truncated`, serialized first. */
export async function aLongListIsTruncated(): Promise<void> {
  const rows = Array.from({ length: 200 }, (_, i) => template(ORG_A, `T${String(i).padStart(3, "0")}`, 1, { name: "n".repeat(120) }));
  const out = await fake({ [ORG_A]: rows }).tools.dispatch("list_asset_templates", {}, ctx());
  if (!out.ok) throw new Error(out.error);
  const content = succeed(scrubToolResult(out.result)).content;
  const parsed = JSON.parse(content) as { truncated: boolean; items: unknown[] };
  expect([parsed.truncated, parsed.items.length < 200, content.indexOf('"truncated"') < content.indexOf('"items"')]).toEqual([
    true,
    true,
    true,
  ]);
}

/** The tool takes only `code`, `domain` and `status` (strict). */
export function theToolTakesCodeDomainAndStatus(): void {
  const definition = fake({}).tools.registry.definitions.find((d) => d.name === "list_asset_templates");
  expect(Object.keys((definition?.parameters as { properties: Record<string, unknown> }).properties)).toEqual(["code", "domain", "status"]);
}
