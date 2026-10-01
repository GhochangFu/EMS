import { MAX_DASHBOARD_WIDGETS } from "../contracts/dashboard-builder";
import { mimicPresetSchema } from "../contracts/mimic-config";
import {
  sectionTemplateContentSchema,
  stockDashboardTemplateDtoSchema,
  templateTargetContentMessage,
} from "../contracts/dashboard-templates";
import type { StockDashboardTemplateDto } from "../index";
import { SMOC_STANDARD_SITE_TEMPLATE } from "./smoc-standard";

/**
 * `F3.73` plan D8 — the SMOC standard site layout. Assertions live here; `smoc-standard.test.ts`
 * is the Vitest entry point (ADR 0014). One claim per exported function.
 *
 * The role and point-key vocabularies are NOT checked here: `stock-catalog.spec.ts` and
 * `tests/f3.38-stock-catalog-vocabulary.test.ts` read them out of the migrations and the
 * `*_POINT_KEYS` arrays, and both walk this entry's tab widgets.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// Widened to the contract type, so a tab without an optional key reads as `undefined`.
const entry: StockDashboardTemplateDto = SMOC_STANDARD_SITE_TEMPLATE;

export function theEntryIsTheSiteTargetStockRow(): void {
  const shape = `${entry.code}|${entry.section}|${entry.target}|${entry.stockVersion}`;
  assert(shape === "smoc-standard|site|site|1", `code|section|target|stockVersion: got ${shape}`);
}

export function theEntryParsesUnderTheStockContract(): void {
  const parsed = stockDashboardTemplateDtoSchema.safeParse(entry);
  assert(parsed.success, `stockDashboardTemplateDtoSchema refused it: ${JSON.stringify(parsed.error?.issues)}`);
}

export function theContentParsesUnderTheContentSchema(): void {
  const parsed = sectionTemplateContentSchema.safeParse(entry.content);
  assert(parsed.success, `sectionTemplateContentSchema refused it: ${JSON.stringify(parsed.error?.issues)}`);
}

export function theContentFitsTheSiteTarget(): void {
  const message = templateTargetContentMessage(entry.target, entry.content);
  assert(message === null, `the target rule refused it: ${message}`);
}

export function theTabsAreThePlanOrder(): void {
  const keys = entry.content.tabs.map((tab) => `${tab.key}:${tab.domain ?? "null"}`).join(",");
  assert(
    keys ===
      "overview:null,sld:electrical,ups:electrical,hvac:hvac,it:it,env:environment,water:water",
    `tabs in order: got ${keys}`,
  );
}

export function everyTabPresetIsAPresetOption(): void {
  const options = new Set<string>(mimicPresetSchema.options);
  for (const tab of entry.content.tabs) {
    if (tab.mimicPreset !== undefined) {
      assert(options.has(tab.mimicPreset), `tab ${tab.key} names preset ${tab.mimicPreset}`);
    }
  }
}

/** A tab's mimic draws the tab's own preset, and a tab with no preset draws no mimic. */
export function everyMimicDrawsItsTabsPreset(): void {
  for (const tab of entry.content.tabs) {
    const drawn = tab.widgets.flatMap((widget) =>
      widget.widgetType === "mimic" && widget.config.source === "preset" ? [widget.config.preset] : [],
    );
    const expected = tab.mimicPreset === undefined ? [] : [tab.mimicPreset];
    assert(
      drawn.join(",") === expected.join(","),
      `tab ${tab.key}: mimics draw [${drawn.join(",")}], the tab names [${expected.join(",")}]`,
    );
  }
}

export function everyModuleCardNamesATab(): void {
  const keys = new Set(entry.content.tabs.map((tab) => tab.key));
  for (const tab of entry.content.tabs) {
    for (const widget of tab.widgets) {
      if (widget.widgetType === "module_summary_card") {
        assert(
          keys.has(widget.config.targetTabKey),
          `${tab.key}/${widget.key} targets ${widget.config.targetTabKey}, which is no tab`,
        );
      }
    }
  }
}

/** One card per group tab on the Overview, in tab order — ruling Q6b. */
export function theOverviewHasOneCardPerGroupTab(): void {
  const [overview, ...groupTabs] = entry.content.tabs;
  const cards = (overview?.widgets ?? []).flatMap((widget) =>
    widget.widgetType === "module_summary_card" ? [widget.config.targetTabKey] : [],
  );
  const expected = groupTabs.map((tab) => tab.key);
  assert(cards.join(",") === expected.join(","), `Overview cards: got ${cards.join(",")}`);
}

export function noTabHoldsMoreThanTheWidgetCap(): void {
  for (const tab of entry.content.tabs) {
    assert(
      tab.widgets.length <= MAX_DASHBOARD_WIDGETS,
      `tab ${tab.key} holds ${tab.widgets.length} widgets, over ${MAX_DASHBOARD_WIDGETS}`,
    );
  }
}

/**
 * ADR 0049 decision 4 — stock content names roles, never an asset. `CR-` is the control-room
 * asset-code prefix the seeds use. This reads the VALUE; the file's text, docblocks included, is
 * scanned by `tests/f3.38-stock-catalog-vocabulary.test.ts`, which reads it as text already.
 */
export function theValueNamesNoControlRoomAssetCode(): void {
  assert(!JSON.stringify(entry).includes("CR-"), "the entry's value spells an asset code");
}
