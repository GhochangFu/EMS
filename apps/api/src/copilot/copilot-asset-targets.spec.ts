import { expect } from "vitest";

import type { BmsTx } from "../database/tenant-context";
import { readAssetTarget } from "./copilot-asset-targets";

/**
 * `F4.316` PR 7 (ADR 0111 decision 5, ruling Q4) — the resolver's `asset`
 * target read, moved out of `copilot-target-resolver.ts` for the AGENTS.md
 * §4.5 cap. A card names its asset by the label (`<code> · <RTU>`, else
 * `<code> · <location>`), and the target keeps the pinned version and the
 * point keys a formula may name. The database claims are the integration
 * spec's (`copilot-asset-targets.integration.spec.ts`). Vitest entry point:
 * the sibling `.test.ts` (ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";
const TEMPLATE = "44444444-4444-4444-8444-444444444444";

/** A transaction that answers each read — a `… limit` or an awaited `… where` — with the next of `results`. */
function queuedTx(results: unknown[][]): BmsTx {
  const next = async () => results.shift() ?? [];
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    leftJoin: () => chain,
    where: () => ({ limit: next, then: (resolve: (value: unknown) => unknown) => next().then(resolve) }),
  };
  return chain as never;
}

function read(row: Record<string, unknown> | null, points: string[] = ["kw"]) {
  return readAssetTarget(queuedTx([row ? [row] : [], points.map((pointKey) => ({ pointKey }))]), ASSET, ORG);
}

/** Q4: an asset with an RTU is named `<code> · <RTU display name>`. */
export async function anAssetWithAnRtuIsNamedByCodeAndRtu(): Promise<void> {
  const found = await read({ code: "PHE-MFM-000000003", rtuName: "Lotapata I", locationName: "Lotapata", templateId: null });
  expect(found?.name).toBe("PHE-MFM-000000003 · Lotapata I");
}

/** C2: an asset with no RTU is named `<code> · <location name>`. */
export async function anAssetWithNoRtuIsNamedByCodeAndLocation(): Promise<void> {
  const found = await read({ code: "WTR-WTP-01", rtuName: null, locationName: "Lotapata", templateId: null });
  expect(found?.name).toBe("WTR-WTP-01 · Lotapata");
}

/** The target keeps its organization, pinned version (Amendment 11 G2) and point keys. */
export async function theTargetKeepsItsTemplateAndPointKeys(): Promise<void> {
  const found = await read({ code: "P-7", rtuName: "R", locationName: "L", templateId: TEMPLATE }, ["kw", "kva"]);
  expect(found).toEqual({ organizationId: ORG, name: "P-7 · R", templateId: TEMPLATE, pointKeys: ["kw", "kva"] });
}

/** An asset not found in the organization is `null`. */
export async function aMissingAssetIsNull(): Promise<void> {
  expect(await read(null)).toBeNull();
}
