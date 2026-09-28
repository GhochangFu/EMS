import { rejects } from "./asset-templates-content.schema.spec";

/**
 * `F3.32` / ADR 0079 — a template refuses a `mimic` even with a well-formed config.
 *
 * Its own function, so the mutation it guards — a template arm added for `mimic` — reddens this
 * claim rather than only the arm-count derivation inside `runTemplateContentSchemaTests`, which
 * fails first in the same body. An asset template has no asset group, and a mimic resolves its
 * nodes from one; `isTemplateAuthorableWidgetType` excludes it by its point maximum of zero.
 */
export function templateRefusesAWellFormedMimic(): void {
  rejects(
    {
      dashboards: {
        overview: {
          featured: ["A"],
          widgets: [
            {
              widgetType: "mimic",
              config: { source: "preset", preset: "water_train" },
              pointKeys: [],
              gridX: 0,
              gridY: 0,
              gridW: 12,
              gridH: 6,
            },
          ],
        },
      },
    },
    "a mimic is not template-authorable — an asset template has no asset group to resolve it",
  );
}
