import { buildAnomalyCards } from "../ml/ml-findings.anomaly-facts";
import {
  COLD_ROOMS,
  FREEZERS,
  FXA,
  FXB,
  FX_NOW,
  PUMPS,
  RTU_H1,
  forecastRows,
  fxaAnomalyRows,
  fxaColdRoomPoints,
  fxbAnomalyRows,
  meansOf,
  thresholdRule,
} from "../ml/ml-findings.fixture";
import { buildForecastCards } from "../ml/ml-findings.forecast-facts";
import type { FindingsCardFacts } from "../ml/ml-findings.lines";

/**
 * `E1.9c` (plan T3.2, T3.4) — the paragraph specs' cards, built by `E1.9a`'s
 * own fact builders from its made-up `FXA`/`FXB` fixture. **Made-up names only:
 * the repository is public.** Used by specs only.
 */

const cardOf = (cards: readonly FindingsCardFacts[], code: string): FindingsCardFacts => {
  const card = cards.find((c) => c.organizationCode === code);
  if (!card) throw new Error(`no ${code} card`);
  return card;
};

/** `FXA`'s forecast card with two rule crossings, so it holds F1–F5, rule names and times. */
export function fxaForecastCard(): FindingsCardFacts {
  const points = fxaColdRoomPoints();
  const room = (code: string) => COLD_ROOMS.find((a) => a.code === code)!;
  return cardOf(
    buildForecastCards(
      {
        rows: points.flatMap(forecastRows),
        means: meansOf(points),
        rules: [thresholdRule(room("CR-07"), "gt", -17.5), thresholdRule(room("CR-03"), "lt", -18.4)],
        organizations: [],
        narrowed: false,
      },
      FX_NOW,
    ),
    "FXA",
  );
}

/** `FXB`'s forecast card: no forecast point, so `F_NONE` alone. */
export function fxbForecastCard(): FindingsCardFacts {
  return cardOf(
    buildForecastCards(
      {
        rows: [],
        means: [],
        rules: [],
        organizations: [{ organization_id: FXB.id, organization_code: FXB.code, organization_name: FXB.name }],
        narrowed: false,
      },
      FX_NOW,
    ),
    "FXB",
  );
}

export function anomalyCards(rows = [...fxaAnomalyRows(), ...fxbAnomalyRows()]): FindingsCardFacts[] {
  return buildAnomalyCards({ rows, organizations: [] }, FX_NOW);
}

/** `FXA`: 21 Baseline-only hours on 7 of 18 (A1, five A3, the Baseline-only A4). */
export const fxaAnomalyCard = (): FindingsCardFacts => cardOf(anomalyCards(), "FXA");
/** `FXB`: `RTU-H1` marked by both methods (A2 first), the mixed A4. */
export const fxbAnomalyCard = (): FindingsCardFacts => cardOf(anomalyCards(), "FXB");

/** Every name and id of the fixture that must never leave the host or reach the table. */
export function fixtureSecrets(): string[] {
  const assets = [...COLD_ROOMS, ...FREEZERS, RTU_H1, ...PUMPS];
  return [
    FXA.name,
    FXB.name,
    FXA.code,
    FXB.code,
    FXA.id,
    FXB.id,
    "North Yard",
    "East Yard",
    "River Plant",
    "RTU-N1",
    "RTU-E1",
    "high temperature",
    ...assets.flatMap((a) => [a.code, a.id]),
  ];
}

/** Any UUID-shaped text. */
export const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
