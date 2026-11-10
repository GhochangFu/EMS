import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { COLOUR_PROFILES, DESIGN_SYSTEMS } from "@bms/shared";
import type { ColourProfile, DesignSystem } from "@bms/shared";

import { fetchCurrentUser } from "../../api/login";
import { apiErrorMessage } from "../../lib/api-error-message";
import { useAuthStore } from "../../stores/auth-store";
import { previewDesign, previewProfile } from "../../stores/theme-store";
import { COLOUR_PROFILE_LABELS, DESIGN_SYSTEM_LABELS } from "./labels";

export type AppearanceValue = { designSystem: DesignSystem | null; colourProfile: ColourProfile | null };

type Props = {
  /** A short name for the level, used in the two list names ("Portal", "This organization", "My"). */
  levelLabel: string;
  /** The stored values at this level; `null` is "inherit". */
  initial: AppearanceValue;
  /** `false` at the portal level: the portal default is never empty. */
  allowInherit: boolean;
  /** What "Inherit" resolves to now, when it is known, for its label and its preview. */
  inherited?: Partial<{ designSystem: DesignSystem; colourProfile: ColourProfile }>;
  /** Writes the values; the panel then re-reads `/auth/me` and refreshes the lists. */
  save: (value: AppearanceValue) => Promise<unknown>;
  onDone: () => void;
};

const INHERIT = "inherit";

/**
 * `F4.341` PR 12 (ADR 0118 decision 11) — the one Appearance panel, reused at the three levels
 * (the portal, an organization, the user). Two lists, the design systems and the colour profiles.
 * A choice previews the whole page with the real tokens; Cancel (or leaving) restores the viewer's
 * own look; Save writes, re-reads `/auth/me` so the viewer's page follows its effective values, and
 * refreshes the organization and portal reads. "Inherit (<value>)" writes `null`, except at the
 * portal level. The alarm and state colours never change (ADR 0110 decision 2).
 */
export function AppearancePanel({ levelLabel, initial, allowInherit, inherited, save, onDone }: Props) {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [value, setValue] = useState<AppearanceValue>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      previewDesign(null);
      previewProfile(null);
    },
    [],
  );

  function chooseDesign(next: DesignSystem | null): void {
    setValue((v) => ({ ...v, designSystem: next }));
    previewDesign(next ?? inherited?.designSystem ?? null);
  }

  function chooseProfile(next: ColourProfile | null): void {
    setValue((v) => ({ ...v, colourProfile: next }));
    previewProfile(next ?? inherited?.colourProfile ?? null);
  }

  function cancel(): void {
    previewDesign(null);
    previewProfile(null);
    onDone();
  }

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await save(value);
      // `F4.346`: re-read `/auth/me` before the preview ends, so the shell goes straight to the
      // saved value rather than back to the old one for a moment.
      if (accessToken) await fetchCurrentUser(accessToken).catch(() => undefined);
      previewDesign(null);
      previewProfile(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "organizations"] });
      await queryClient.invalidateQueries({ queryKey: ["appearance"] });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const unchanged = value.designSystem === initial.designSystem && value.colourProfile === initial.colourProfile;
  const incomplete = !allowInherit && (value.designSystem === null || value.colourProfile === null);

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">
        A choice previews this page until you save or cancel. The alarm and state colours stay the same in every choice.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="space-y-2" disabled={pending}>
          <legend className="text-sm font-semibold text-ink">{levelLabel} design system</legend>
          {allowInherit ? (
            <Choice
              name="design-system"
              value={INHERIT}
              checked={value.designSystem === null}
              onChange={() => chooseDesign(null)}
              label={`Inherit${inherited?.designSystem ? ` (${DESIGN_SYSTEM_LABELS[inherited.designSystem].label})` : ""}`}
              description="Use the next level's choice."
            />
          ) : null}
          {DESIGN_SYSTEMS.map((d) => (
            <Choice
              key={d}
              name="design-system"
              value={d}
              checked={value.designSystem === d}
              onChange={() => chooseDesign(d)}
              label={DESIGN_SYSTEM_LABELS[d].label}
              description={DESIGN_SYSTEM_LABELS[d].description}
            />
          ))}
        </fieldset>
        <fieldset className="space-y-2" disabled={pending}>
          <legend className="text-sm font-semibold text-ink">{levelLabel} colour profile</legend>
          {allowInherit ? (
            <Choice
              name="colour-profile"
              value={INHERIT}
              checked={value.colourProfile === null}
              onChange={() => chooseProfile(null)}
              label={`Inherit${inherited?.colourProfile ? ` (${COLOUR_PROFILE_LABELS[inherited.colourProfile].label})` : ""}`}
              description="Use the next level's choice."
            />
          ) : null}
          {COLOUR_PROFILES.map((p) => (
            <Choice
              key={p}
              name="colour-profile"
              value={p}
              checked={value.colourProfile === p}
              onChange={() => chooseProfile(p)}
              label={COLOUR_PROFILE_LABELS[p].label}
              description={COLOUR_PROFILE_LABELS[p].description}
            />
          ))}
        </fieldset>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-critical-ink">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="surface-button px-3 py-1.5 text-sm" onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          className="surface-button-primary bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-60"
          onClick={() => void submit()}
          disabled={pending || unchanged || incomplete}
          aria-busy={pending}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Choice(props: { name: string; value: string; checked: boolean; onChange: () => void; label: string; description: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 surface-raised-sm p-2 text-sm">
      <input type="radio" name={props.name} value={props.value} checked={props.checked} onChange={props.onChange} className="mt-1" />
      <span>
        <span className="block font-semibold text-ink">{props.label}</span>
        <span className="block text-xs text-ink-muted">{props.description}</span>
      </span>
    </label>
  );
}
