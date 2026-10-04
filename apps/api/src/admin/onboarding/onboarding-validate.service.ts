import { Injectable } from "@nestjs/common";

import {
  type OnboardingDraft,
  type OnboardingFieldError,
  type OnboardingPhase,
} from "@bms/shared";

import { echoedItems, moreTail, quoteCell } from "../spreadsheet-guard";
import {
  draftAssetPointSchema,
  draftAssetSchema,
  draftLocationSchema,
  draftPointKeySchema,
  draftRtuSchema,
  onboardingDraftSchema,
} from "./onboarding.schema";
import {
  draftTemplateCode,
  draftTemplateRef,
  heldVersions,
  isStockEntry,
  patternGrammarProblem,
  resolveTemplateForAsset,
  templateSourceKeyMessage,
  templateSourceKeyProblem,
  templateVariables,
  type TemplateRef,
  type ValidateTemplateContext,
} from "./onboarding-template-refs";

export type ValidateResult = {
  valid: boolean;
  errors: OnboardingFieldError[];
  readyToCommit: boolean;
  suggestedPhase: OnboardingPhase;
};

/** Validates onboarding draft business rules. */
@Injectable()
export class OnboardingValidateService {
  /**
   * Runs schema and cross-field validation on a draft.
   *
   * `F4.162` (ADR 0077 Amendment 1, plan D9, owner ruling OQ3):
   * `activeLocationTypeCodes` is the active `bms.location_types` codes, read by
   * the caller. Required, with no default: an optional parameter is invisible
   * at an adapter, and `tsc` then names every caller. A stored type that is not
   * in it counts as missing, so a type retired after it was stored is reported
   * here, and `readyToCommit` agrees with the commit's 400.
   *
   * `F3.22` (ADR 0091 decisions 2, 6 and 7): `templates` is every version the
   * organization holds and the stock catalog, read once per request by
   * `OnboardingTemplateCatalogService.context`. Required for the same reason
   * as the codes: an optional context would let a caller validate templated
   * assets against nothing, and the template rules would refuse every one.
   */
  validate(
    draft: unknown,
    activeLocationTypeCodes: readonly string[],
    templates: ValidateTemplateContext,
  ): ValidateResult {
    const errors: OnboardingFieldError[] = [];
    const parsed = onboardingDraftSchema.safeParse(draft);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          path: issue.path.join("."),
          message: issue.message,
        });
      }
      return {
        valid: false,
        errors,
        readyToCommit: false,
        suggestedPhase: this.inferPhase(draft, activeLocationTypeCodes),
      };
    }

    const d = parsed.data as OnboardingDraft;
    this.validateCrossField(d, errors, activeLocationTypeCodes);
    validateDraftTemplates(d, templates, errors);
    validateTemplatedAssets(d, templates, errors);
    const phase = this.inferPhase(d, activeLocationTypeCodes);
    const readyToCommit = errors.length === 0 && phase === "review";
    return {
      valid: errors.length === 0,
      errors,
      readyToCommit,
      suggestedPhase: phase,
    };
  }

  private validateCrossField(
    d: OnboardingDraft,
    errors: OnboardingFieldError[],
    activeLocationTypeCodes: readonly string[],
  ): void {
    if (d.location) {
      const loc = draftLocationSchema.safeParse(d.location);
      if (!loc.success) {
        for (const issue of loc.error.issues) {
          errors.push({ path: `location.${issue.path.join(".")}`, message: issue.message });
        }
      }
      // F4.157 / ADR 0077 decision 7 (owner ruling OQ2): `type` is optional in
      // the draft so the chat can store the name in one turn and ask for the
      // type in the next. It is not optional at commit.
      if (!d.location.type) {
        errors.push({ path: "location.type", message: "Location type is required" });
      } else if (!activeLocationTypeCodes.includes(d.location.type)) {
        // F4.162 (D9): the stored value is operator text and is not echoed; the
        // codes are what the operator can pick from. The list is capped (the
        // F4.105 echo bound): the vocabulary is admin-managed and can grow.
        errors.push({
          path: "location.type",
          message: inactiveLocationTypeMessage(activeLocationTypeCodes),
        });
      }
    }

    const rtuCount = d.rtus?.length ?? 0;
    if (d.rtus) {
      d.rtus.forEach((rtu, i) => {
        const r = draftRtuSchema.safeParse(rtu);
        if (!r.success) {
          for (const issue of r.error.issues) {
            errors.push({ path: `rtus.${i}.${issue.path.join(".")}`, message: issue.message });
          }
        }
        if (rtu.protocol === "mqtt" && rtu.ingestEnabled && !rtu.credentialsSet) {
          errors.push({
            path: `rtus.${i}.credentialsSet`,
            message: "MQTT ingest requires credentials",
          });
        }
        if (rtu.protocol === "mqtt" && !rtu.config.topic && !rtu.config.mqttTopic) {
          const topic = rtu.config.topic ?? rtu.config.mqttTopic;
          if (!topic) {
            errors.push({
              path: `rtus.${i}.config.topic`,
              message: "MQTT topic is required",
            });
          }
        }
      });
    }

    if (d.assets) {
      d.assets.forEach((asset, i) => {
        const a = draftAssetSchema.safeParse(asset);
        if (!a.success) {
          for (const issue of a.error.issues) {
            errors.push({ path: `assets.${i}.${issue.path.join(".")}`, message: issue.message });
          }
        } else if (asset.rtuIndex >= rtuCount) {
          errors.push({
            path: `assets.${i}.rtuIndex`,
            message: "rtuIndex out of range",
          });
        }
      });
    }

    if (d.pointKeys) {
      d.pointKeys.forEach((pk, i) => {
        const p = draftPointKeySchema.safeParse(pk);
        if (!p.success) {
          for (const issue of p.error.issues) {
            errors.push({ path: `pointKeys.${i}.${issue.path.join(".")}`, message: issue.message });
          }
        }
      });
    }

    if (d.assetPoints) {
      const assetCount = d.assets?.length ?? 0;
      d.assetPoints.forEach((ap, i) => {
        const p = draftAssetPointSchema.safeParse(ap);
        if (!p.success) {
          for (const issue of p.error.issues) {
            errors.push({ path: `assetPoints.${i}.${issue.path.join(".")}`, message: issue.message });
          }
        } else if (ap.assetIndex >= assetCount) {
          errors.push({
            path: `assetPoints.${i}.assetIndex`,
            message: "assetIndex out of range",
          });
        } else if (d.assets?.[ap.assetIndex]?.template) {
          // F3.22 V4: a templated asset's points are the template's; a mapping
          // onto it would write a second, unplanned row beside them.
          errors.push({
            path: `assetPoints.${i}.assetIndex`,
            message:
              `Asset ${quoteCell(d.assets[ap.assetIndex].code)} is built from a template; ` +
              "its points come from the template, so map no point to it",
          });
        }
      });
    }

    if (!d.location) {
      errors.push({ path: "location", message: "Location is required before commit" });
    }
    if (!d.rtus || d.rtus.length === 0) {
      errors.push({ path: "rtus", message: "At least one RTU is required before commit" });
    }
    if (!d.assets || d.assets.length === 0) {
      errors.push({ path: "assets", message: "At least one asset is required before commit" });
    }
  }

  /**
   * Infers the current onboarding phase from draft completeness.
   *
   * `F4.162` (D9): a type that is not in `activeLocationTypeCodes` keeps the
   * phase at `location`, as a missing one does, so the chat asks for it again.
   */
  inferPhase(draft: unknown, activeLocationTypeCodes: readonly string[]): OnboardingPhase {
    const d =
      typeof draft === "object" && draft !== null ? (draft as OnboardingDraft) : {};
    if (!d.location?.name) {
      return "location";
    }
    // F4.157: a location with no type stays here, so the chat asks for it.
    if (
      !d.location.code ||
      !d.location.type ||
      !activeLocationTypeCodes.includes(d.location.type) ||
      d.location.latitude === undefined
    ) {
      return "location";
    }
    if (!d.rtus || d.rtus.length === 0 || !d.rtus.every((r) => r.protocol && r.code)) {
      return "rtu";
    }
    if (d.rtus.some((rtu) => this.rtuNeedsMqttSetup(rtu))) {
      return "rtu";
    }
    if (!d.pointKeys || d.pointKeys.length === 0) {
      if (!d.onboardingMeta?.useExistingPointKeys) {
        return "point_keys";
      }
    }
    if (!d.assets || d.assets.length === 0) {
      return "assets";
    }
    // F3.22 V11: a templated asset takes its points from its template, so only
    // a plain asset needs a mapping. A draft whose assets are all templated
    // reaches review with none.
    if (d.assets.some((asset) => !asset.template) && (!d.assetPoints || d.assetPoints.length === 0)) {
      return "mappings";
    }
    return "review";
  }

  private rtuNeedsMqttSetup(rtu: NonNullable<OnboardingDraft["rtus"]>[number]): boolean {
    if (rtu.protocol !== "mqtt" || !rtu.ingestEnabled) {
      return false;
    }
    if (!rtu.credentialsSet) {
      return true;
    }
    const topic = String(rtu.config?.topic ?? rtu.config?.mqttTopic ?? "").trim();
    return !topic || topic === "-";
  }
}

/**
 * `F4.162` (D9) — the `location.type` message for a type that is not active.
 * Names at most {@link echoedItems}' cap of active codes, then a count; with no
 * active code at all it says so, rather than ending on "use one of: ".
 */
function inactiveLocationTypeMessage(activeLocationTypeCodes: readonly string[]): string {
  if (activeLocationTypeCodes.length === 0) {
    return "Location type is not an active code; no location type is active";
  }
  const { shown, omitted } = echoedItems(activeLocationTypeCodes);
  const list = [...shown, moreTail(omitted)].filter(Boolean).join(", ");
  return `Location type is not an active code; use one of: ${list}`;
}

/** A list for a message, bounded by the `F4.105` echo cap. */
function echoedList(items: readonly string[]): string {
  const { shown, omitted } = echoedItems(items);
  return [...shown, moreTail(omitted)].filter(Boolean).join(", ");
}

/**
 * `F3.22` V8, V9, V10 — each draft template entry on its own: a code used once
 * in the draft (V8), each authored point key once (V8), a stock code the
 * release ships with `patterns` only on its measured points (V9), and a code
 * the organization does not hold in any version (V10, decision 6), and every
 * pattern in the shared token grammar (decision 9). A stock
 * entry's code is reported at `stockCode`, the field that carries it. A
 * template no asset uses is valid (decision 11): an upload that replaced
 * `assets[]` keeps it, and the commit still publishes it.
 */
function validateDraftTemplates(d: OnboardingDraft, ctx: ValidateTemplateContext, errors: OnboardingFieldError[]): void {
  const seen = new Set<string>();
  (d.templates ?? []).forEach((entry, i) => {
    const code = draftTemplateCode(entry);
    const codePath = `templates.${i}.${isStockEntry(entry) ? "stockCode" : "code"}`;
    if (seen.has(code)) {
      errors.push({ path: codePath, message: `Template ${quoteCell(code)} appears more than once in this draft` });
    }
    seen.add(code);

    if (isStockEntry(entry)) {
      const stock = draftTemplateRef(entry, ctx);
      if (stock === null) {
        errors.push({ path: codePath, message: `${quoteCell(code)} is not a stock template this release ships` });
      } else {
        const measured = new Set(stock.points.filter((p) => p.kind === "measured").map((p) => p.pointKey));
        for (const key of Object.keys(entry.patterns ?? {})) {
          if (!measured.has(key)) {
            errors.push({
              path: `templates.${i}.patterns.${key}`,
              message: `${quoteCell(key)} is not a measured point of stock template ${quoteCell(code)}`,
            });
          }
        }
      }
      // Decision 9 (code review): the grammar is checked here too, not only by
      // the two tools — a `PATCH :id/draft` body reaches the commit unchecked.
      for (const [key, pattern] of Object.entries(entry.patterns ?? {})) {
        const grammar = patternGrammarProblem(pattern);
        if (grammar !== null) {
          errors.push({ path: `templates.${i}.patterns.${key}`, message: grammar });
        }
      }
    } else {
      const keys = new Set<string>();
      entry.points.forEach((point, j) => {
        if (keys.has(point.pointKey)) {
          errors.push({
            path: `templates.${i}.points.${j}.pointKey`,
            message: `Point ${quoteCell(point.pointKey)} appears more than once in template ${quoteCell(code)}`,
          });
        }
        keys.add(point.pointKey);
        const grammar = point.sourceDataKeyPattern === undefined ? null : patternGrammarProblem(point.sourceDataKeyPattern);
        if (grammar !== null) {
          errors.push({ path: `templates.${i}.points.${j}.sourceDataKeyPattern`, message: grammar });
        }
      });
    }

    const held = heldVersions(ctx, code);
    if (held.length > 0) {
      errors.push({
        path: codePath,
        message:
          `This organization already holds template ${quoteCell(code)} ` +
          `(versions: ${echoedList(held.map(String))}); choose another code`,
      });
    }
  });
}

/** The points that must resolve to a source key, or the asset cannot be built. */
function requiredMeasured(ref: TemplateRef): TemplateRef["points"] {
  return ref.points.filter((point) => point.kind === "measured" && point.required);
}

/**
 * `F3.22` V1, V2, V3, V5, V6, V7 — each templated asset against the template
 * it names: the template resolves (V1, V2, decision 6), the domains agree (V3),
 * every required measured point has a pattern (V5, owner ruling Q1-C) that
 * resolves with the asset's variables and its own code to a non-empty key, and
 * no measured point resolves over the length limit (V6), and every variable
 * is one the template asks for (V7). An organization template must name its
 * version (decision 2). V5 and V6 read `templateSourceKeyProblem`, the
 * predicate of the instantiate core's `resolveSourceDataKey` and `planAsset`,
 * so an asset this passes is one `planAsset` can build.
 */
function validateTemplatedAssets(d: OnboardingDraft, ctx: ValidateTemplateContext, errors: OnboardingFieldError[]): void {
  (d.assets ?? []).forEach((asset, i) => {
    if (!asset.template) {
      return;
    }
    const resolved = resolveTemplateForAsset(d, asset.template, ctx);
    if ("problem" in resolved) {
      errors.push({ path: `assets.${i}.template.${resolved.field}`, message: resolved.problem });
      return;
    }
    const ref = resolved.ref;
    const code = quoteCell(ref.code);
    if (resolved.source === "organization" && asset.template.version === undefined) {
      // Decision 2 (code review): an organization template is pinned, so the
      // draft hash binds one immutable version. Unpinned, a version published
      // between the proposal and the confirm would be the one the commit builds.
      errors.push({
        path: `assets.${i}.template.version`,
        message: `Template ${code} is an organization template; name the version to build from (the highest published is ${ref.version})`,
      });
    }
    if (asset.domain !== ref.domain) {
      errors.push({
        path: `assets.${i}.domain`,
        message: `Template ${code} is in domain ${quoteCell(ref.domain)}; an asset built from it must be in the same domain`,
      });
    }

    const required = requiredMeasured(ref);
    const missingPattern = required.find((point) => point.sourceDataKeyPattern === null);
    if (missingPattern !== undefined) {
      errors.push({
        path: `assets.${i}.template`,
        message:
          `Template ${code} has no source-key pattern for its required point ${quoteCell(missingPattern.pointKey)}; ` +
          "give that point a pattern before this asset can be built",
      });
    }

    const vars = asset.template.sourceDataKeyVars ?? {};
    const problem = templateSourceKeyProblem(ref, vars, asset.code);
    if (problem !== null) {
      errors.push({ path: `assets.${i}.template.sourceDataKeyVars`, message: templateSourceKeyMessage(code, problem) });
    }

    const variables = templateVariables(ref);
    for (const key of Object.keys(vars)) {
      if (!variables.includes(key)) {
        errors.push({
          path: `assets.${i}.template.sourceDataKeyVars`,
          message:
            `${quoteCell(key)} is not a variable of template ${code}; ` +
            (variables.length === 0 ? "it has no variables" : `its variables are: ${echoedList(variables)}`),
        });
      }
    }
  });
}
