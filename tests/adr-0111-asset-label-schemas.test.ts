import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * ADR 0111 (`F4.316`) — a response schema that names an asset by its code also names where the
 * asset is: `assetRtuName` and `assetLocationName` in the SAME `z.object`, so the web, the exports
 * and the copilot can print `assetLabel(...)` (`packages/shared/src/asset-label.ts`) instead of a
 * bare code that two RTUs of one site both use.
 *
 * ## How the walk finds a schema
 *
 * It reads every `packages/shared/src/contracts/*.ts`, strips comments, and for each `z.object(`, `z.strictObject(`,
 * `.extend(` and `.safeExtend(` takes the balanced `( … )` span. A block's OWN text is that span with nested such spans
 * cut out, so a parent is not blamed for its child's field. A block is named by the nearest
 * `const <name> =` above it, so an inline object inside a schema (the copilot import preview's
 * `mappingsToCreate` rows) is named by the schema that holds it.
 *
 * ## What counts as a candidate
 *
 * 1. a block whose own text has an `assetCode:` field, and
 * 2. (owner ruling Q1: the same `assetRtuName` / `assetLocationName` names everywhere) a block
 *    whose asset-code field is a bare `code:`. These are named in `ASSET_ROWS_WITH_A_BARE_CODE`
 *    and not detected, because a bare `code:` cannot be told structurally from a template's,
 *    RTU's or location's code: a companion-field heuristic (`siteName` / `assetId` / `freshness`)
 *    was tried and also matched eight write bodies and already-labelled rows. The list is
 *    permanent (the rule keeps applying after a schema is widened); the "live candidate" check
 *    fails a rename, so a stale name cannot hide a row.
 *
 * A candidate that is not on the allow-list must carry both fields. The walk finding zero
 * candidates fails, so a broken walk cannot pass.
 */
const contractsDir = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "packages",
  "shared",
  "src",
  "contracts",
);

/**
 * Schemas that still lack the two fields, one entry per line, keyed `<file>#<schema>`. A later PR
 * of `F4.316` widens the schema, its producers and its screens, and deletes ITS lines here — the
 * "every entry is a live candidate" check fails if it forgets, and the main check fails if it
 * deletes a line without widening. Each line stands alone so two PRs never touch the same line.
 */
const NOT_YET_WIDENED: readonly string[] = [
];

/**
 * Schemas that name an asset code and are NOT given the fields, one entry per line. These do not
 * go away (plan §5.1, "N/A").
 */
const PERMANENTLY_EXEMPT: readonly string[] = [
  "template-migration.ts#templateMigrationSkippedPointDtoSchema", // permanent: a refusal row about an asset the operator picked on the previous step; its message names the asset
  "template-adoption.ts#templateAdoptionRefusalDtoSchema", // permanent: a refusal row about an asset the operator picked on the previous step; its message names the asset
  "calc-point-writes.ts#calcPointRefusalSchema", // permanent: assetCode is nullable for a disclosure reason (its docblock); its message names the asset
  "mapping-sheet.ts#mappingSheetCreateDtoSchema", // permanent: the code is the sheet's round-trip key, not a display label
  "mapping-sheet.ts#mappingSheetUpdateDtoSchema", // permanent: the code is the sheet's round-trip key, not a display label
  "telemetry-import.ts#copilotTelemetryImportPreviewSchema", // permanent: the code is the import's round-trip key (mappingsToCreate)
];

/**
 * Asset rows whose code field is `code`, not `assetCode` (plan §5.1 rows 8, 18, 19; ruling Q1).
 * Add a new such schema here when you write one. Not an exemption: they are held to the rule
 * unless they are also on `NOT_YET_WIDENED`.
 */
const ASSET_ROWS_WITH_A_BARE_CODE: readonly string[] = [
  "generated-site-view.ts#generatedSiteAssetSchema",
  "operations.ts#energyTopConsumerSchema",
  "energy-organization-views.ts#energyAbnormalEntrySchema",
];

interface Block {
  readonly key: string;
  readonly own: string;
}

function stripComments(source: string): string {
  // Replace with spaces of equal length is unnecessary here; only structure matters.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** The index just past the `)` that closes the `(` at `open`. Strings are skipped. */
function closeOf(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      for (i++; i < source.length && source[i] !== quote; i++) {
        if (source[i] === "\\") {
          i++;
        }
      }
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  throw new Error(
    `unbalanced parentheses near ${source.slice(open, open + 60)} — the walk is broken`,
  );
}

function blocksOf(file: string, raw: string): Block[] {
  const source = stripComments(raw);
  const names = [
    ...source.matchAll(
      /^\s*(?:export\s+)?const\s+(\w+)\s*(?::[^=]*?)?=(?!>)/gm,
    ),
  ].map((m) => ({
    at: m.index ?? 0,
    name: m[1] as string,
  }));
  const spans = [
    ...source.matchAll(
      /\bz\s*\.(?:object|strictObject)\s*\(|\.(?:extend|safeExtend)\s*\(/g,
    ),
  ].map((m) => {
    const open = (m.index ?? 0) + m[0].length - 1;
    return { start: open, end: closeOf(source, open) };
  });
  return spans.map((span) => {
    const children = spans.filter(
      (other) =>
        other !== span && other.start > span.start && other.end <= span.end,
    );
    let own = "";
    let cursor = span.start;
    for (const child of children.sort((a, b) => a.start - b.start)) {
      if (child.start < cursor) {
        continue; // a grandchild — already cut with its parent
      }
      own += source.slice(cursor, child.start);
      cursor = child.end;
    }
    own += source.slice(cursor, span.end);
    const holder = [...names].reverse().find((n) => n.at < span.start);
    return { key: `${file}#${holder?.name ?? "<anonymous>"}`, own };
  });
}

function hasField(own: string, field: string): boolean {
  return new RegExp(`(^|[\\s{,])${field}\\s*:`).test(own);
}

function isCandidate(block: Block): boolean {
  return (
    hasField(block.own, "assetCode") ||
    (ASSET_ROWS_WITH_A_BARE_CODE.includes(block.key) &&
      hasField(block.own, "code"))
  );
}

const allBlocks = (): Block[] =>
  readdirSync(contractsDir)
    .filter((f) => f.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(f))
    .flatMap((f) => blocksOf(f, readFileSync(join(contractsDir, f), "utf8")));

describe("ADR 0111 — a schema that names an asset code names its RTU and location", () => {
  const candidates = allBlocks().filter(isCandidate);
  const exempt = new Set([...NOT_YET_WIDENED, ...PERMANENTLY_EXEMPT]);

  it("finds candidates at all (a broken walk cannot pass)", () => {
    expect(
      candidates.length,
      "the walk found no asset-naming schema — it is broken",
    ).toBeGreaterThan(15);
  });

  it("gives every non-exempt asset-naming schema assetRtuName and assetLocationName", () => {
    const offenders = candidates
      .filter((b) => !exempt.has(b.key))
      .filter(
        (b) =>
          !(
            hasField(b.own, "assetRtuName") &&
            hasField(b.own, "assetLocationName")
          ),
      )
      .map((b) => b.key);
    expect(offenders).toEqual([]);
  });

  it("lists in the allow-lists only schemas the walk still sees as candidates", () => {
    const live = new Set(candidates.map((b) => b.key));
    const stale = [...exempt].filter((key) => !live.has(key));
    expect(
      stale,
      "stale allow-list entries — a schema was renamed or removed",
    ).toEqual([]);
  });

  it("keeps a widened schema off the allow-list", () => {
    const widened = candidates
      .filter((b) => exempt.has(b.key))
      .filter(
        (b) =>
          hasField(b.own, "assetRtuName") &&
          hasField(b.own, "assetLocationName"),
      )
      .filter((b) => !PERMANENTLY_EXEMPT.includes(b.key))
      .map((b) => b.key);
    expect(widened, "widened but still listed — delete the line").toEqual([]);
  });

  it("finds every named bare-code asset row", () => {
    const live = new Set(candidates.map((b) => b.key));
    expect(ASSET_ROWS_WITH_A_BARE_CODE.filter((key) => !live.has(key))).toEqual(
      [],
    );
  });

  it("names each candidate block once (a block that inherits a neighbour's name hides it)", () => {
    const keys = candidates.map((b) => b.key);
    const repeated = keys.filter((key, i) => keys.indexOf(key) !== i);
    expect(repeated).toEqual([]);
  });

  it("lists no entry twice", () => {
    const all = [...NOT_YET_WIDENED, ...PERMANENTLY_EXEMPT];
    expect(all.length).toBe(new Set(all).size);
  });
});
