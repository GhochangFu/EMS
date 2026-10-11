import { z } from "zod";

import {
  CALC_DIALECT,
  CALC_DIALECTS,
  isCrossAssetDialect,
  CALC_TRIGGERS,
  formatCalcError,
  MAX_CALC_INTERVAL_SECONDS,
  MAX_INPUT_AGE_SECONDS_BOUND,
  MIN_CALC_INTERVAL_SECONDS,
  validateFormula,
} from "../calc-dsl";
import { templateContentSchema } from "./asset-template-content-writes";
import { calcDialectSchema } from "./asset-templates";
import { assetDomainCodeSchema } from "./operations";
import { hasAnyPointMetadata, pointMetadataBodyShape, refinePointMetadata } from "./point-metadata-writes";

/**
 * The structural write bodies of the asset-template admin surface (ADR 0015,
 * backlog F2.1), moved here from
 * `apps/api/src/admin/asset-templates/asset-templates.schema.ts` by `F3.85`
 * PR 11a (ADR 0099 decision 6, plan §11.3 Unit 1) so the copilot catalog can
 * name `updateAssetTemplateBodySchema` by identity — `packages/shared` must
 * not import `apps/api`.
 *
 * Byte for byte below this note except for one rule that stayed behind: the
 * template **cycle** check. `templateCycles` lives in
 * `apps/api/src/calc/calc-graph.ts`, which the scheduled sweep shares
 * (ADR 0055 decision 8), so the api file exports
 * `createAssetTemplateBodySchema` and `updateAssetTemplateBodySchema` as these
 * two plus an outer `.superRefine` that reports each cycle member at
 * `points.<index>.formula` with the same message. **A body parsed here alone
 * admits a cycle**; the routes parse the api wrap.
 */

const pointKeyCode = z.string().min(1).max(128);

export const templatePointBodySchema = z
  .object({
    pointKey: pointKeyCode,
    label: z.string().max(255).nullish(),
    unit: z.string().max(32).nullish(),
    kind: z.enum(["measured", "derived"]).default("measured"),
    sourceDataKeyPattern: z.string().max(128).nullish(),
    // ADR 0036 decision 5. Cross-point rules (a derived formula's references
    // must resolve to measured siblings, decision 7) cannot live here — a
    // per-point refinement cannot see the rest of the array — and are enforced
    // by templatePointsBodySchema's own superRefine below instead.
    formula: z.string().min(1).max(1000).nullish(),
    // ADR 0055 decision 2 (`F2.9`): the vocabulary is `CALC_DIALECTS`, derived
    // once as `calcDialectSchema`. Never a literal here — a literal pins this
    // one endpoint to `bms-calc-v1` while every other endpoint accepts `v2`,
    // so the same stored row reads back on one page and 400s on another
    // (`tests/adr-0055-calc-v2-invariants.test.ts` part (c)).
    formulaDialect: calcDialectSchema.nullish(),
    // ADR 0037 decision 4: when the formula above runs, and how stale its
    // inputs may be. Cross-checked against `kind`/`calcTrigger` below —
    // a per-point refinement, unlike decision 7's cross-point rule, since
    // every fact this needs lives on the point itself.
    calcTrigger: z.enum(CALC_TRIGGERS).nullish(),
    calcIntervalSeconds: z.number().int().min(MIN_CALC_INTERVAL_SECONDS).max(MAX_CALC_INTERVAL_SECONDS).nullish(),
    maxInputAgeSeconds: z.number().int().min(1).max(MAX_INPUT_AGE_SECONDS_BOUND).nullish(),
    // ADR 0055 decision 11 (`F2.9`): the fraction of an aggregate's *declared*
    // members that must carry a fresh value before the result is written.
    //
    // **The `(0, 1]` bound lives here, on the write side, and nowhere else.**
    // `0` would admit an aggregate computed over nothing, and anything above
    // `1` can never be satisfied — both are author mistakes, and both are
    // silent at evaluation time. `adminTemplatePointDtoSchema` deliberately
    // carries no bound: a read reports what the row holds, and migration
    // `0062` puts no `CHECK` on the column (the `0035`/`0036` precedent).
    //
    // Absent or `null` means **fail closed** — every declared member must be
    // fresh — not "no limit". Refused below on anything but a `v2` derived
    // point, where it is the only shape that has an aggregate to cover.
    minCoverageRatio: z.number().gt(0).max(1).nullish(),
    required: z.boolean().default(true),
    sortOrder: z.number().int().min(0).default(0),
    // F2.13 / ADR 0052 decision 2, ADR 0040 open question 4 — the tier
    // marking that makes a client's redline mechanical (C -> core, X ->
    // extended). `bms.template_points.meta jsonb` has carried this since
    // `0024`; nothing could write it until now. A CLOSED shape, not
    // `z.record(z.unknown())` — `meta` is provenance with exactly one known
    // key today, and a free-form jsonb bag on an authoring surface is the
    // drift ADR 0019 §3 refuses.
    meta: z.object({ tier: z.enum(["core", "extended", "manual"]) }).strict().optional(),
    // `F2.7` / ADR 0056 decisions 1 and 3 — the five instrument-metadata
    // **class defaults**: scale, engineering band and quality policy. Spread
    // from the one write-side shape every authoring body uses
    // (`point-metadata.schema.ts`), so the template surface and the per-asset
    // override surface cannot drift on the bounds or on the vocabulary.
    //
    // `null`/absent means the template declares no default, and a resolved
    // `NULL` is today's behaviour: multiplier 1, offset 0, no range test,
    // `discard_bad`. The per-asset override is `asset_points`' own five,
    // coalesced per column by the ingest host.
    ...pointMetadataBodyShape,
  })
  // `.strict()` must sit on the object, before `.superRefine` — a
  // `ZodEffects` (what `.superRefine`/`.refine`/`.transform` return) has no
  // `.strict()`. Nothing may separate `.superRefine(...)` from the
  // `.describe(...)` below it (tests/adr-0029-openapi-contract.test.ts).
  .strict()
  .superRefine((point, ctx) => {
    const hasFormula = point.formula != null || point.formulaDialect != null;
    // The dialect itself is checked by `calcDialectSchema` above, so all this
    // has to see is that both fields are present. The message names every
    // dialect rather than one, because since ADR 0055 there are two.
    if (point.kind === "derived" && (!point.formula || point.formulaDialect == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formula"],
        message:
          'A derived point requires "formula" and a formulaDialect of ' +
          CALC_DIALECTS.map((dialect) => `"${dialect}"`).join(" or "),
      });
    }
    if (point.kind === "measured" && hasFormula) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formula"],
        message: 'A measured point must not carry a formula — only "derived" points may',
      });
    }

    const hasCalcConfig =
      point.calcTrigger != null || point.calcIntervalSeconds != null || point.maxInputAgeSeconds != null;
    if (point.kind === "measured" && hasCalcConfig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["calcTrigger"],
        message: "A measured point must not carry calcTrigger, calcIntervalSeconds, or maxInputAgeSeconds",
      });
    }
    if (point.kind === "derived") {
      // ADR 0055 decision 10, mirrored at the write boundary. A `bms-calc-v2`
      // formula resolves its cross-asset membership once per sweep, so there
      // is nothing for it to resolve against on a single incoming reading —
      // a streaming `v2` point would store clean and never compute.
      //
      // Combined with the `scheduled -> interval required` branch below, this
      // is the whole of decision 10 here: a `v2` point IS scheduled, therefore
      // it MUST carry an interval, so a null interval becomes a save-time
      // rejection instead of a formula that silently never runs.
      // ADR 0070 decision 3 extends the rule to `v3`: the gate reads the
      // capability, never the version (a literal `v2` comparison would admit a
      // streaming `v3` point), and the message names the row's own dialect.
      if (point.formulaDialect != null && isCrossAssetDialect(point.formulaDialect) && point.calcTrigger !== "scheduled") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["calcTrigger"],
          message:
            `A "${point.formulaDialect}" point requires calcTrigger: "scheduled" — a cross-asset or parameter ` +
            "formula resolves its inputs once per sweep and cannot run on a single reading",
        });
      }
      if (point.calcTrigger == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["calcTrigger"],
          message: 'A derived point requires calcTrigger: "streaming" or "scheduled"',
        });
      } else if (point.calcTrigger === "scheduled" && point.calcIntervalSeconds == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["calcIntervalSeconds"],
          message: "A scheduled point requires calcIntervalSeconds",
        });
      } else if (point.calcTrigger === "streaming" && point.calcIntervalSeconds != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["calcIntervalSeconds"],
          message: "A streaming point must not carry calcIntervalSeconds — it runs on every matching reading",
        });
      }
    }

    // ADR 0055 decision 11. The ratio is the coverage of an *aggregate's*
    // member set, and only a `v2` derived formula can hold an aggregate — on
    // anything else it is a value that reads as configured and is never
    // consulted, which is the silent shape this repository refuses.
    if (
      point.minCoverageRatio != null &&
      !(point.kind === "derived" && point.formulaDialect != null && isCrossAssetDialect(point.formulaDialect))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minCoverageRatio"],
        message:
          `minCoverageRatio applies only to a derived point in a cross-asset dialect, not "${CALC_DIALECT}" — ` +
          "it is the fraction of an aggregate's declared members that must be fresh",
      });
    }

    // ADR 0056 decision 3's last sentence. `hasAnyPointMetadata` reads an
    // explicit `null` as absent, which is what makes this compatible with the
    // two surfaces that restate all five on every point: the Points tab clears
    // them to `null` when a row flips to `derived`, and `createDraftFrom`
    // copies a parent version's row through this same body shape.
    if (point.kind === "derived" && hasAnyPointMetadata(point)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scaleMultiplier"],
        message:
          "A derived point has no instrument to scale or to bound: scaleMultiplier, " +
          "scaleOffset, engMin, engMax and qualityPolicy describe a measured signal, and " +
          "a computed value is produced from points that already carry them",
      });
    }

    // The within-row bounds, from the one shared refinement body — never
    // restated here. A second `.superRefine` on this object would move the
    // `.describe()` below onto an inner node, where the OpenAPI generator never
    // looks (ADR 0029 Amendment 1).
    refinePointMetadata(point, ctx);
  })
  .describe(
    'A derived point requires "formula", a formulaDialect of "bms-calc-v1", ' +
      '"bms-calc-v2" or "bms-calc-v3", and a calcTrigger of "streaming" or "scheduled" ("scheduled" also ' +
      'requires calcIntervalSeconds). A "bms-calc-v2" or "bms-calc-v3" point must be "scheduled", and is ' +
      "the only shape that may carry minCoverageRatio, which is bounded to (0, 1] and " +
      "means fail-closed when absent. A measured point must carry none of those fields. " +
      "The five instrument-metadata defaults belong to a measured point only: " +
      "scaleMultiplier must not be 0, engMin must be below engMax when both are stated, " +
      "and qualityPolicy is one of discard_bad or accept_bad. Null means the template " +
      "sets no default, which resolves to multiplier 1, offset 0, no range test and " +
      "discard_bad.",
  );

/**
 * A template's full point set. Sent whole on create and on every draft update —
 * the points ARE the template, and a partial patch would leave "did you mean to
 * delete the ones you omitted?" ambiguous on the one object where a silently
 * dropped point becomes a missing `asset_points` row on every future asset.
 *
 * Duplicate `pointKey`s are rejected here rather than by
 * `template_points_template_point_key_unique`, so the caller is told which code
 * collided instead of receiving a constraint name.
 *
 * ADR 0036 decision 7's sibling rule lives here too, not on
 * `templatePointBodySchema`: a per-point refinement cannot see the rest of the
 * array, and "does this formula's `{ref}` resolve to a measured point" needs
 * every other point's `kind`.
 */
const templatePointsBodySchema = z
  .array(templatePointBodySchema)
  .max(500)
  .superRefine((points, ctx) => {
    const seen = new Set<string>();
    points.forEach((point, index) => {
      if (seen.has(point.pointKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "pointKey"],
          message: `Duplicate point key "${point.pointKey}" in this template`,
        });
      }
      seen.add(point.pointKey);
    });

    const kindByKey = new Map(points.map((point) => [point.pointKey, point.kind]));
    const declaredKeys = points.map((point) => point.pointKey);

    points.forEach((point, index) => {
      if (point.kind !== "derived" || !point.formula) {
        // no formula, or already flagged by templatePointBodySchema's own
        // per-point refinement — nothing this sibling-scoped check can add
        return;
      }
      // A point that reached here has a dialect (the per-point refinement
      // refuses a derived point without one); the fallback keeps this total
      // rather than parsing `v2` syntax under `v1` rules by accident.
      const dialect = point.formulaDialect ?? CALC_DIALECT;
      const result = validateFormula(point.formula, declaredKeys, { dialect });
      if (!result.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "formula"],
          message: `Invalid formula: ${formatCalcError(result.errors[0])}`,
        });
        return;
      }
      if (dialect !== CALC_DIALECT) {
        // ADR 0055 decision 7 repeals the refusal below for `bms-calc-v2`: a
        // `v2` formula may reference a derived point, and the cycle — not the
        // reference — is what has to be refused. That check is
        // `templateCycles(points)`, and it runs **once** over the whole array:
        // a cycle is a property of the whole array, so running it per point
        // would report every cycle as many times as it has members. It is
        // api-only (`calc-graph.ts`), so since `F3.85` PR 11a it is the outer
        // refine `apps/api/src/admin/asset-templates/asset-templates.schema.ts`
        // puts on the create and update bodies below.
        return;
      }
      const derivedRef = result.refs.find((ref) => kindByKey.get(ref) === "derived");
      if (derivedRef) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "formula"],
          message:
            derivedRef === point.pointKey
              ? "This point's formula references itself — a derived formula may only " +
                "reference measured points"
              : "This point's formula references another derived point — a derived formula " +
                "may only reference measured points",
        });
      }
    });
  })
  .describe(
    "Every `pointKey` must be unique within this template's points. A derived point's " +
      "`formula` must parse under the dialect it declares, and every local `{ref}` must " +
      "resolve to a point declared in this array. Under bms-calc-v1, none of those " +
      "references may resolve to another derived point; bms-calc-v2 lifts that restriction " +
      "(ADR 0055 decision 7) and its cross-asset references resolve at evaluation time.",
  );

export const createAssetTemplateBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(255),
    assetType: z.string().min(1).max(64),
    // ADR 0031 Amendment 1: shape only; `AssetTemplatesService` checks the code
    // against `bms.asset_domains`. Instantiating a template copies this value
    // straight onto every asset it creates
    // (`asset-templates-instantiate.service.ts`), so an unchecked template domain
    // becomes a foreign-key violation one hop later, at instantiation time, far
    // from the form that caused it.
    domain: assetDomainCodeSchema,
    description: z.string().max(2000).nullish(),
    content: templateContentSchema.optional(),
    points: templatePointsBodySchema.default([]),
  })
  .strict();

/**
 * Draft edits only. `code` and `organizationId` are absent on purpose: they are
 * the identity a published version's pin resolves through, and `version` is
 * assigned by the version-bump rule, never by a caller.
 */
export const updateAssetTemplateBodySchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    assetType: z.string().min(1).max(64).optional(),
    domain: assetDomainCodeSchema.optional(),
    description: z.string().max(2000).nullish(),
    content: templateContentSchema.optional(),
    points: templatePointsBodySchema.optional(),
  })
  .strict();
