import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";

import type { AdminOrganizationDto, CardPrimaryMetric, EnergyFeatures } from "@bms/shared";
import { CARD_PRIMARY_METRICS, ENERGY_FEATURES } from "@bms/shared/contracts";

import { setOrganizationEnergySettings } from "../../api/admin/organizations";
import { apiErrorMessage } from "../../lib/api-error-message";

/** The Energy features choices, in the contract's order (`F4.364` U10; moved here from the page by `F4.375`). */
const ENERGY_FEATURE_LABELS: Record<EnergyFeatures, string> = {
  auto: "Auto — show where there is energy data",
  on: "On",
  off: "Off",
};

/** The location card's first-figure choices, in the contract's order (`F4.364` U10; moved here by `F4.375`). */
const CARD_PRIMARY_METRIC_LABELS: Record<CardPrimaryMetric, string> = {
  auto: "Auto — kW with energy, asset health without",
  kw: "kW",
  health: "Asset health %",
  critical_alarms: "Critical alarms",
  none: "None",
};

/**
 * `F4.375` (plan D12) — what a saved setting changes on screen: the organization list, the
 * location cards and the estate ribbon, refreshed at once instead of on their next poll.
 */
const QUERIES_AFTER_SAVE = [["admin", "organizations"], ["dashboard", "locations"], ["dashboard", "kpis"]] as const;

/**
 * `F4.375` (ADR 0133 Amendment 2 ruling 3, plan-gate ruling Q6, plan U9) — an organization's two
 * energy settings, on their one write path (`PUT …/energy-settings`). Opened from the row action
 * **Energy settings** beside **Appearance**, for the global admin and an organization admin; the
 * API decides again on every write, so a refusal is the server's sentence shown inline and the
 * dialog stays open.
 */
export function OrganizationEnergySettingsDialog({
  organization,
  onClose,
}: {
  organization: AdminOrganizationDto;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [energyFeatures, setEnergyFeatures] = useState<EnergyFeatures>(organization.energyFeatures);
  const [cardPrimaryMetric, setCardPrimaryMetric] = useState<CardPrimaryMetric>(organization.cardPrimaryMetric);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => setOrganizationEnergySettings(organization.id, { energyFeatures, cardPrimaryMetric }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await Promise.all(QUERIES_AFTER_SAVE.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })));
      onClose();
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    save.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="organization-energy-settings-title"
        className="w-full max-w-md surface-dialog p-4"
        onSubmit={handleSubmit}
      >
        <h2 id="organization-energy-settings-title" className="font-condensed text-lg font-bold text-ink">
          Energy settings — {organization.name}
        </h2>
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-semibold text-ink-muted">
            Energy features
            <select
              className="mt-1 w-full surface-field px-3 py-2 text-sm"
              value={energyFeatures}
              onChange={(event) => setEnergyFeatures(event.target.value as EnergyFeatures)}
            >
              {ENERGY_FEATURES.map((value) => (
                <option key={value} value={value}>
                  {ENERGY_FEATURE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-ink-muted">
            Location card first figure
            <select
              className="mt-1 w-full surface-field px-3 py-2 text-sm"
              value={cardPrimaryMetric}
              onChange={(event) => setCardPrimaryMetric(event.target.value as CardPrimaryMetric)}
            >
              {CARD_PRIMARY_METRICS.map((value) => (
                <option key={value} value={value}>
                  {CARD_PRIMARY_METRIC_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          {error ? (
            <p role="alert" className="text-xs text-critical-ink">
              {error}
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="surface-button px-3 py-2" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
            disabled={save.isPending}
            aria-busy={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
