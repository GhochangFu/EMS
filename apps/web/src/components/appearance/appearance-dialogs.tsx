import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { AdminOrganizationDto } from "@bms/shared";

import { setMyAppearance, setOrganizationAppearance } from "../../api/appearance";
import { fetchCurrentUser } from "../../api/login";
import { fetchPublicAppearance } from "../../api/public-appearance";
import { useAuthStore } from "../../stores/auth-store";
import { AppearancePanel } from "./appearance-panel";

function DialogFrame({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={id} className="max-h-full w-full max-w-3xl overflow-y-auto surface-dialog p-4">
        <h2 id={id} className="mb-3 font-condensed text-lg font-bold text-ink">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/**
 * `F4.341` PR 12 (ADR 0118 decisions 10–11) — an organization's appearance, replacing the
 * `F4.310` colour-profile dialog. "Inherit" is the portal default, read from the public route
 * (an organization admin cannot read the portal settings). Every user of the organization who has
 * not chosen their own sees these values.
 */
export function OrganizationAppearanceDialog({ organization, onClose }: { organization: AdminOrganizationDto; onClose: () => void }) {
  const portal = useQuery({ queryKey: ["appearance", "public"], queryFn: fetchPublicAppearance });
  return (
    <DialogFrame id="organization-appearance-title" title={`Appearance — ${organization.name}`}>
      <AppearancePanel
        levelLabel="Organization"
        initial={{ designSystem: organization.designSystem, colourProfile: organization.colourProfile }}
        allowInherit
        inherited={portal.data}
        save={(value) => setOrganizationAppearance(organization.id, value)}
        onDone={onClose}
      />
    </DialogFrame>
  );
}

/**
 * `F4.341` PR 12 — the signed-in user's own appearance (the shell's "Appearance" button). Its
 * current values come from `/auth/me`: a value whose level is `user` is the user's own; any other
 * is what "Inherit" gives now.
 */
export function MyAppearanceDialog({ onClose }: { onClose: () => void }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const me = useQuery({
    queryKey: ["appearance", "me"],
    queryFn: () => fetchCurrentUser(accessToken ?? ""),
    enabled: accessToken !== null,
  });
  const appearance = me.data?.appearance;
  return (
    <DialogFrame id="my-appearance-title" title="My appearance">
      {appearance ? (
        <AppearancePanel
          levelLabel="My"
          initial={{
            designSystem: appearance.designSystem.from === "user" ? appearance.designSystem.value : null,
            colourProfile: appearance.colourProfile.from === "user" ? appearance.colourProfile.value : null,
          }}
          allowInherit
          inherited={{
            ...(appearance.designSystem.from !== "user" ? { designSystem: appearance.designSystem.value } : {}),
            ...(appearance.colourProfile.from !== "user" ? { colourProfile: appearance.colourProfile.value } : {}),
          }}
          save={(value) => setMyAppearance(value)}
          onDone={onClose}
        />
      ) : (
        <p className="text-sm text-ink-muted">{me.isError ? "Could not read your appearance." : "Loading…"}</p>
      )}
    </DialogFrame>
  );
}
