import { StatusPill } from "../status-pill";

/** The badge's tooltip: why the figure needs checking. */
export const TARIFF_VERIFY_TITLE =
  "Priced at a tariff whose rates are not from an official tariff order (secondary or indicative data) — verify before relying on it";

/**
 * `F4.365` (ADR 0134; plan Q8) — the "Verify" badge on a figure priced at a
 * slab tariff whose data status is not `official`. The existing `warning` tone,
 * no new colour role. Callers key it on the API's `tariffVerify` (cost tiles)
 * or on a version's `dataStatus` (the tariff pages).
 */
export function TariffVerifyBadge() {
  return (
    <span title={TARIFF_VERIFY_TITLE} aria-label={`Verify: ${TARIFF_VERIFY_TITLE}`}>
      <StatusPill label="Verify" tone="warning" />
    </span>
  );
}
