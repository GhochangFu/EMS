import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { fetchPortalAppearance, setPortalAppearance } from "../../api/appearance";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { AppearancePanel } from "../../components/appearance/appearance-panel";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import type { AuthUser } from "../../stores/auth-store";

/**
 * `F4.341` PR 12 (ADR 0118 decisions 9–12) — `/admin/portal-appearance`, the portal default design
 * system and colour profile: what the sign-in page shows, and what every organization and user
 * without their own choice sees. The global `admin` only (the API refuses every other role too).
 * Both values are required here: the portal level has no "Inherit".
 */
export function PortalAppearancePage({ user }: { user: AuthUser }) {
  const portal = useQuery({ queryKey: ["appearance", "portal"], queryFn: fetchPortalAppearance, enabled: user.role === "admin" });
  if (user.role !== "admin") return <Navigate to="/admin" replace />;
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Portal appearance"
        subtitle="The default for the sign-in page, and for every organization and user that has not chosen their own."
      />
      <SectionCard title="Portal default">
        {portal.data ? (
          <AppearancePanel
            key={`${portal.data.designSystem}-${portal.data.colourProfile}`}
            levelLabel="Portal"
            initial={{ designSystem: portal.data.designSystem, colourProfile: portal.data.colourProfile }}
            allowInherit={false}
            // Save is disabled until both are chosen (`allowInherit={false}`), so the defaults never apply.
            save={(value) =>
              setPortalAppearance({ designSystem: value.designSystem ?? "nexus-soft", colourProfile: value.colourProfile ?? "nexus" })
            }
            onDone={() => undefined}
          />
        ) : (
          <p className="text-sm text-ink-muted">{portal.isError ? "Could not read the portal appearance." : "Loading…"}</p>
        )}
      </SectionCard>
    </MasterDataLayout>
  );
}
