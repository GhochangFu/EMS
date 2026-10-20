import { expect } from "vitest";
import { z } from "zod";

import { catalogEntry, proposeToolName } from "@bms/shared/copilot";

import { ASSET_CREATE_IDS, PROPOSE_ASSET_NOT_ASKED_ERROR } from "./copilot-asset-intent";
import type { TurnAttachment } from "./copilot-attachments";
import { COPILOT_READ_FROM_FILE_NOTE, type CopilotProposeServices } from "./copilot-propose-tools";
import { proposeHarness, UPLOAD_ENTRY } from "./copilot-propose-tools.spec";
import { VALID_SVG } from "./copilot-upload-prepare.spec";

/**
 * `F3.87` PR 7 (ADR 0099 Amendment 3, plan D8 and D11) — the two propose rules
 * a file turn adds: the asset and point creates are withheld unless the words
 * ask, and a layout card proposed from a file says so. Vitest entry point: the
 * sibling `.test.ts` (ADR 0014).
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ASSET_TOOLS = [...ASSET_CREATE_IDS].map((id) => proposeToolName({ id }));

const LAYOUT = {
  organizationId: ORG_X,
  name: "Raw water",
  slug: "raw-water",
  canvasW: 120,
  canvasH: 80,
  nodes: [{ key: "tank_1", kind: "unit", symbol: "tank", label: "Tank 1", x: 40, y: 0, w: 20, h: 25 }],
  pipes: [],
  symbolLibraries: ["core"],
};

const PNG: TurnAttachment = {
  index: 1,
  filename: "plant.png",
  mediaType: "image/png",
  byteSize: 64,
  sha256: "a".repeat(64),
  data: Buffer.alloc(64),
};

function layoutHarness() {
  const layouts = {
    missingRoleCodes: async () => [],
    validateProposal: async () => ({ baseline: null }),
  } as unknown as NonNullable<CopilotProposeServices["layouts"]>;
  return proposeHarness({ catalog: [catalogEntry("mimicLayout.create")!], layouts });
}

/** D8: a registry built without the asset creates names none of the three; the full one names all three. Mutation: drop the filter → red. */
export function aRegistryWithoutAssetCreatesNamesNone(): void {
  const h = proposeHarness();
  const without = h.tools.registryFor({ access: false, role: "admin", assetCreate: false }).definitions.map((d) => d.name);
  const withThem = h.tools.registryFor({ access: false, role: "admin" }).definitions.map((d) => d.name);
  for (const name of ASSET_TOOLS) {
    expect(without, name).not.toContain(name);
    expect(withThem, name).toContain(name);
  }
  expect(without).toContain(proposeToolName({ id: "dashboard.create" }));
}

/** D8, the second guard: called anyway with `assetIntent: false`, the create is refused and nothing is stored. Mutation: drop the guard → red. */
export async function anAssetCreateWithoutTheWordsIsRefused(): Promise<void> {
  const h = proposeHarness();
  const outcome = await h.call(proposeToolName({ id: "asset.create" }), { body: {} }, { assetIntent: false });
  expect(outcome).toMatchObject({ ok: false, error: PROPOSE_ASSET_NOT_ASKED_ERROR });
  expect(h.stored).toEqual([]);
}

/** The adjacent positive: with the words (or no file), the guard lets the call reach the body check. */
export async function anAssetCreateWithTheWordsPassesTheGuard(): Promise<void> {
  const h = proposeHarness();
  const outcome = await h.call(proposeToolName({ id: "asset.create" }), { body: {} }, { assetIntent: true });
  expect(outcome.ok).toBe(false);
  expect(outcome.error).not.toBe(PROPOSE_ASSET_NOT_ASKED_ERROR);
}

/** D8 in `fill_step` too: a file turn cannot pre-fill an asset wizard without the words (review #6). Mutation: drop it → red. */
export async function anAssetFillStepWithoutTheWordsIsRefused(): Promise<void> {
  const h = proposeHarness();
  const args = { catalogId: "asset.create", params: {}, stepId: catalogEntry("asset.create")!.steps[0]!.id, values: {} };
  // `F4.245`: the create wizard is open, so the adjacent positive reaches the step check.
  const openWizards = [{ catalogId: "asset.create", params: {}, name: null, organizationId: null }];
  expect(await h.call("fill_step", args, { assetIntent: false, openWizards })).toMatchObject({ ok: false, error: PROPOSE_ASSET_NOT_ASKED_ERROR });
  const allowed = await h.call("fill_step", args, { assetIntent: true, openWizards });
  expect(allowed.ok).toBe(true);
}

/** D11: a layout proposed in a turn that carries a file stores a summary with the note. */
export async function aLayoutFromAFileCarriesTheNote(): Promise<void> {
  const h = layoutHarness();
  expect((await h.call("propose_mimicLayout_create", { body: LAYOUT }, { attachments: [PNG] })).ok).toBe(true);
  expect(h.stored[0]?.summary.endsWith(COPILOT_READ_FROM_FILE_NOTE)).toBe(true);
}

/** D11: the next turn, with no file, after one that attached a file, also carries it. Mutation: read `ctx.attachments` only → red. */
export async function aLayoutAfterAFileInHistoryCarriesTheNote(): Promise<void> {
  const h = layoutHarness();
  expect((await h.call("propose_mimicLayout_create", { body: LAYOUT }, { historyHasAttachmentSinceLastLayout: true })).ok).toBe(true);
  expect(h.stored[0]?.summary.endsWith(COPILOT_READ_FROM_FILE_NOTE)).toBe(true);
}

/** Without a file now or since the last layout, no note (the positive control for the two above). */
export async function aLayoutWithoutAFileHasNoNote(): Promise<void> {
  const h = layoutHarness();
  expect((await h.call("propose_mimicLayout_create", { body: LAYOUT }, { historyHasAttachmentSinceLastLayout: false })).ok).toBe(true);
  expect(h.stored[0]?.summary).toBe('Create the layout "Raw water" in Org X: 1 unit, 0 panels, 0 pipes.');
}

/**
 * A3: the SVG source can be a file this turn carries, named by its 1-based
 * index. The stored body takes the file's name and text; an index on a file
 * that is not an SVG is refused. Mutation: pass no attachments to
 * `prepareUpload` → red.
 */
export async function anAttachedSvgIsTheUploadSource(): Promise<void> {
  const entry = {
    ...UPLOAD_ENTRY,
    id: "fixture.symbol.upload.attached",
    modelBody: z
      .object({ name: z.string().optional(), svg: z.object({ kind: z.literal("attachment"), index: z.number().int() }).strict() })
      .strict(),
  };
  const h = proposeHarness({ catalog: [entry] });
  const svg: TurnAttachment = { ...PNG, index: 2, filename: "valve.svg", mediaType: "image/svg+xml", svgText: VALID_SVG };
  const name = proposeToolName(entry);
  const notSvg = await h.call(name, { body: { name: "v", svg: { kind: "attachment", index: 1 } } }, { attachments: [PNG, svg] });
  expect(notSvg.ok).toBe(false);
  const ok = await h.call(name, { body: { name: "v", svg: { kind: "attachment", index: 2 } } }, { attachments: [PNG, svg] });
  expect(ok.ok).toBe(true);
  expect(h.stored[0]?.body).toMatchObject({ name: "v", filename: "valve.svg", svgText: VALID_SVG });
}

/** The note is for a layout card only: another card proposed from a file has none. */
export async function anotherCardFromAFileHasNoNote(): Promise<void> {
  const h = proposeHarness();
  const outcome = await h.call(proposeToolName({ id: "dashboardTemplate.publish" }), { id: "55555555-5555-4555-8555-555555555555" }, { attachments: [PNG] });
  expect(outcome.ok).toBe(true);
  expect(h.stored[0]?.summary).not.toContain(COPILOT_READ_FROM_FILE_NOTE);
}
