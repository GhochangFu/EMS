// `reflect-metadata` first: the service carries `@Inject(FLEET_DRIZZLE)`, and the
// decorator calls `Reflect.defineMetadata` when the module is evaluated.
import "reflect-metadata";

import { assetTemplates, templatePoints } from "@bms/db";

import { dashboardWidgetRowsFor } from "../asset-templates/asset-dashboards-plan";
import { parseStoredTemplateContent } from "../asset-templates/asset-templates-content.schema";
import { STOCK_ASSET_TEMPLATE_CATALOG } from "../asset-templates/stock-catalog/stock-catalog";
import { OnboardingTemplateCatalogService } from "./onboarding-template-catalog.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The first shipped entry whose content seeds alarms and dashboard widgets, so the counts are not zero by accident. */
function contentWithAlarmsAndWidgets(): { content: Record<string, unknown>; alarms: number; widgets: number } {
  for (const entry of STOCK_ASSET_TEMPLATE_CATALOG) {
    const parsed = parseStoredTemplateContent(entry.content);
    if (parsed.ok && (parsed.content.alarms ?? []).length > 0) {
      const widgets = dashboardWidgetRowsFor(parsed.content.dashboards ?? {});
      if (widgets > 0) {
        return { content: entry.content as Record<string, unknown>, alarms: parsed.content.alarms!.length, widgets };
      }
    }
  }
  throw new Error("the shipped catalog has no entry with both alarms and dashboard widgets");
}

type Select = { table: unknown; fields: string[] };

/**
 * A fake `fleetDb` answering the two selects by table: `asset_templates` rows,
 * then `template_points` rows. Every select is recorded, so a spec can say how
 * many the service issued and against which table.
 */
function fakeDb(templateRows: unknown[], pointRows: unknown[]): { db: never; selects: Select[] } {
  const selects: Select[] = [];
  const db = {
    select(fields: Record<string, unknown>) {
      return {
        from(table: unknown) {
          selects.push({ table, fields: Object.keys(fields) });
          const rows = table === assetTemplates ? templateRows : table === templatePoints ? pointRows : [];
          const chain = {
            where: () => chain,
            orderBy: () => Promise.resolve(rows),
          };
          return chain;
        },
      };
    },
  };
  return { db: db as never, selects };
}

const NO_STOCK = { list: () => ({ items: [] }) } as never;

/**
 * S1 — the organization read: every version in every status is listed (V10
 * needs the held ones), a **published** version carries its points and its
 * alarm and widget counts, and a draft version carries no points.
 */
export async function assertS1PublishedVersionsCarryPointsAndDraftsNone(): Promise<void> {
  const { content, alarms, widgets } = contentWithAlarmsAndWidgets();
  const { db, selects } = fakeDb(
    [
      { id: "t1", code: "PUMP", version: 1, name: "Pump", domain: "water", status: "published", content },
      { id: "t2", code: "PUMP", version: 2, name: "Pump", domain: "water", status: "draft", content },
    ],
    [
      { templateId: "t1", pointKey: "flow", kind: "measured", required: true, sourceDataKeyPattern: "{asset_code}_F" },
      { templateId: "t1", pointKey: "eff", kind: "derived", required: false, sourceDataKeyPattern: null },
    ],
  );
  const refs = await new OnboardingTemplateCatalogService(db, NO_STOCK).listOrganizationTemplates("org-1");
  assert(selects.length === 2, `two selects, got ${selects.length}`);
  assert(refs.length === 2, `both versions are listed, got ${refs.length}`);
  const [published, draft] = refs;
  assert(
    JSON.stringify(published.points) ===
      JSON.stringify([
        { pointKey: "flow", kind: "measured", required: true, sourceDataKeyPattern: "{asset_code}_F" },
        { pointKey: "eff", kind: "derived", required: false, sourceDataKeyPattern: null },
      ]),
    `the published version carries its points, got ${JSON.stringify(published.points)}`,
  );
  assert(
    published.alarmCount === alarms && published.dashboardWidgetCount === widgets,
    `the published version counts ${alarms} alarms and ${widgets} widgets, got ${published.alarmCount}/${published.dashboardWidgetCount}`,
  );
  assert(draft.status === "draft" && draft.points.length === 0, `the draft version carries no points, got ${JSON.stringify(draft)}`);
}

/** S1 — with no published version, the `template_points` select is not issued. */
export async function assertS1NoPublishedVersionIssuesOneSelect(): Promise<void> {
  const { db, selects } = fakeDb(
    [{ id: "t2", code: "PUMP", version: 1, name: "Pump", domain: "water", status: "draft", content: {} }],
    [],
  );
  const refs = await new OnboardingTemplateCatalogService(db, NO_STOCK).listOrganizationTemplates("org-1");
  assert(selects.length === 1 && selects[0].table === assetTemplates, `one asset_templates select, got ${selects.length}`);
  assert(refs.length === 1, "the draft version is still listed");
}

/** S2 — the stock projection: one ref per shipped entry, `version` and `status` null, the points as shipped. */
export function assertS2TheStockProjectionHasNoVersion(): void {
  const entries = STOCK_ASSET_TEMPLATE_CATALOG.slice(0, 2);
  const stock = { list: () => ({ items: entries }) } as never;
  const { db, selects } = fakeDb([], []);
  const refs = new OnboardingTemplateCatalogService(db, stock).listStock();
  assert(selects.length === 0, "the stock projection reads no database");
  assert(refs.length === 2, `one ref per entry, got ${refs.length}`);
  for (const [i, ref] of refs.entries()) {
    const entry = entries[i];
    assert(ref.code === entry.code && ref.version === null && ref.status === null, `entry ${i} has no version, got ${JSON.stringify(ref).slice(0, 200)}`);
    assert(ref.stockVersion === entry.stockVersion, `entry ${i} keeps its stockVersion beside the ref`);
    assert(
      JSON.stringify(ref.points.map((point) => point.pointKey)) === JSON.stringify(entry.points.map((point) => point.pointKey)),
      `entry ${i} carries its points as shipped`,
    );
  }
}

/** The context: no organization reads no organization templates and still lists the stock. */
export async function assertTheContextWithNoOrganizationReadsOnlyTheStock(): Promise<void> {
  const entries = STOCK_ASSET_TEMPLATE_CATALOG.slice(0, 1);
  const stock = { list: () => ({ items: entries }) } as never;
  const { db, selects } = fakeDb([], []);
  const context = await new OnboardingTemplateCatalogService(db, stock).context(undefined);
  assert(selects.length === 0, "no organization, no select");
  assert(context.organization.length === 0 && context.stock.length === 1, `got ${JSON.stringify(context).slice(0, 200)}`);
}
