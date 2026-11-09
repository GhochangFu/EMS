import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { COLOUR_PROFILES } from "@bms/shared";
import type { AdminOrganizationDto, ColourProfile } from "@bms/shared";

import { setOrganizationColourProfile } from "../../api/admin/organizations";
import { fetchCurrentUser } from "../../api/login";
import { apiErrorMessage } from "../../lib/api-error-message";
import { useAuthStore } from "../../stores/auth-store";
import { previewProfile } from "../../stores/theme-store";

/** `F4.310` (ADR 0110 Q7) — each profile's name and character, in the contract's order. */
export const COLOUR_PROFILE_LABELS: Readonly<Record<ColourProfile, { label: string; description: string }>> = {
  nexus: { label: "Nexus (default)", description: "Today's colours: the IONSiTE NEXUS green." },
  ocean: { label: "Ocean", description: "A blue accent on cool blue-grey neutrals." },
  lagoon: { label: "Lagoon", description: "A teal accent." },
  indigo: { label: "Indigo", description: "A deep indigo-navy accent on cool neutrals." },
  graphite: { label: "Graphite", description: "A slate-grey accent: the least colour, for a quiet screen." },
  "high-contrast": { label: "High contrast", description: "Darker inks, stronger lines and focus: for control rooms and walls." },
  forest: { label: "Forest", description: "A pine accent on warm beige neutrals." },
  sand: { label: "Sand", description: "A blue accent on charcoal and sand neutrals." },
  "navy-pop": { label: "Navy pop", description: "A magenta accent on navy and white." },
};

type Props = { organization: AdminOrganizationDto; onClose: () => void };

/**
 * `F4.310` (ADR 0110 decision 8) — the colour-profile chooser for one organization. A choice
 * previews the whole page in that profile's real role values; Cancel (or closing) puts the
 * viewer's own profile back. Save writes the profile, re-reads `/auth/me` (so the viewer's own page
 * follows a change to its home organization, and a global admin's goes back to the default), and
 * refreshes the organization list. Alarm and state colours are the same in every profile (Q1).
 */
export function ColourProfileDialog({ organization, onClose }: Props) {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [chosen, setChosen] = useState<ColourProfile>(organization.colourProfile);

  useEffect(() => () => previewProfile(null), []);

  const save = useMutation({
    mutationFn: () => setOrganizationColourProfile(organization.id, chosen),
    onSuccess: async () => {
      previewProfile(null);
      if (accessToken) await fetchCurrentUser(accessToken).catch(() => undefined);
      await queryClient.invalidateQueries({ queryKey: ["admin", "organizations"] });
      onClose();
    },
  });

  function choose(profile: ColourProfile): void {
    setChosen(profile);
    previewProfile(profile);
  }

  function cancel(): void {
    previewProfile(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="colour-profile-title" className="w-full max-w-md surface-dialog p-4">
        <h2 id="colour-profile-title" className="font-condensed text-lg font-bold text-ink">
          Colour profile — {organization.name}
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Every user of this organization sees these colours. The layout, and the alarm and state colours, do not change.
          A choice previews this page until you save or cancel.
        </p>
        <fieldset className="mt-3 space-y-2" disabled={save.isPending}>
          <legend className="sr-only">Colour profile</legend>
          {COLOUR_PROFILES.map((profile) => (
            <label key={profile} className="flex cursor-pointer items-start gap-2 surface-raised-sm p-2 text-sm">
              <input
                type="radio"
                name="colour-profile"
                value={profile}
                checked={chosen === profile}
                onChange={() => choose(profile)}
                className="mt-1"
              />
              <span>
                <span className="block font-semibold text-ink">{COLOUR_PROFILE_LABELS[profile].label}</span>
                <span className="block text-xs text-ink-muted">{COLOUR_PROFILE_LABELS[profile].description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {save.isError ? (
          <p role="alert" className="mt-3 text-xs text-critical-ink">
            {apiErrorMessage(save.error)}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="surface-button px-3 py-1.5 text-sm" onClick={cancel}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-60"
            onClick={() => save.mutate()}
            disabled={save.isPending || chosen === organization.colourProfile}
            aria-busy={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
