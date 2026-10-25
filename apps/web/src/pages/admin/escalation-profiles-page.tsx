import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { EscalationProfileDto, NotificationChannelDto } from "@bms/shared";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  deleteEscalationProfile,
  fetchEscalationDefaults,
  fetchEscalationProfiles,
} from "../../api/escalation";
import { fetchNotificationChannels } from "../../api/notifications";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { EscalationDefaultsWizard } from "../../components/notifications/escalation-defaults-wizard";
import { EscalationProfileWizard } from "../../components/notifications/escalation-profile-wizard";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { apiErrorMessage } from "../../lib/api-error-message";
import { channelOrganizationOptions, organizationLabel } from "../../lib/notification-channels";
import type { AuthUser } from "../../stores/auth-store";

type EscalationProfilesPageProps = { user: AuthUser };

/**
 * `F3.10` — escalation-profile administration (ADR 0057 decision 11, ruling Q5).
 *
 * No mockup covers this screen, so `notification-channels-page.tsx` is the §5
 * reference and this follows it: the same `MasterDataLayout`, the same list-then-
 * form shape, the same organization picker, the same one-`role="alert"` surface
 * for a server refusal. `F4.279` (ADR 0099 decision 6) moved the profile form
 * and the severity map's save onto `WizardShell` (`EscalationProfileWizard`,
 * `EscalationDefaultsWizard`); the organization picker is now the page's own,
 * above both. Three things differ, and each is a consequence of the
 * schema rather than a preference:
 *
 * 1. **There is no fleet-wide profile.** `organization_id` is `NOT NULL` on all
 *    four `F3.10` tables, so `EscalationProfilesService.resolveTargetOrg`
 *    answers an `admin` who names no organization with a 400 instead of
 *    creating a global row. The picker therefore drops
 *    `channelOrganizationOptions`' Fleet-wide entry, and — unlike the channels
 *    page — an `admin` can be asked to choose. `<= 1` locks the control for
 *    every role here, not only for a non-`admin`: with fleet-wide gone, an
 *    `admin` with one organization has no choice to make either.
 *
 * 2. **The chosen organization scopes the whole screen, not just the form.**
 *    `list` spans every organization the caller may administer, while
 *    `GET /admin/escalation-defaults` answers for exactly one. One value drives
 *    both, so the *Severity map* card and the list's Severities column always
 *    describe the same tenant as the form. A row outside it shows no mapped
 *    severity, and the Organization column beside it is what makes that read as
 *    "another tenant" rather than as "unmapped".
 *
 * 3. **The channel checklist is filtered to that organization plus fleet-wide.**
 *    The service resolves every channel id through `ChannelsService.loadById`
 *    and refuses one paired with a different organization (PR 1's M2), so
 *    offering another tenant's channel would be an option that always answers
 *    403. Nothing stored can vanish from the list this way: the same pairing
 *    rule ran when the step was written.
 */
export function EscalationProfilesPage({ user }: EscalationProfilesPageProps) {
  const queryClient = useQueryClient();
  // `F4.279` (ADR 0099 decision 6): the organization the page works in — the
  // severity map's, and a new profile's (fixed in its wizard).
  const [chosenOrganizationId, setChosenOrganizationId] = useState("");
  // `F4.279`: the open wizard — a profile create or edit, or the severity map's save.
  const [open, setOpen] = useState<{ kind: "create" } | { kind: "edit"; profile: EscalationProfileDto } | { kind: "defaults" } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const profilesQ = useQuery({
    queryKey: ["escalation", "profiles"],
    queryFn: fetchEscalationProfiles,
  });

  const channelsQ = useQuery({
    queryKey: ["notifications", "channels"],
    queryFn: fetchNotificationChannels,
  });

  const vocabulariesQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
  });

  // `"all"`, like the channels page: this list resolves the Organization column
  // for rows that may sit in a deactivated organization, and such a row is
  // still real. The picker filters to active separately.
  const organizationsQ = useQuery({
    queryKey: ["admin", "organizations", "all"],
    queryFn: () => fetchAdminOrganizations("all"),
  });
  const organizations = useMemo(
    () => organizationsQ.data?.items ?? [],
    [organizationsQ.data?.items],
  );

  // Fleet-wide dropped — see the header, point 1. Everything else about the
  // per-role set is `channelOrganizationOptions`' decision, and it is the same
  // decision here: this screen is gated by `canManageNotificationChannels`.
  const organizationOptions = useMemo(
    () => channelOrganizationOptions(user.role, organizations).filter((o) => o.value !== ""),
    [user.role, organizations],
  );

  const organizationLocked = organizationOptions.length <= 1;
  const effectiveOrganizationId = organizationLocked
    ? (organizationOptions[0]?.value ?? "")
    : chosenOrganizationId;

  // Create only, the channels page's rule: the list decides it, so the button
  // waits for the list rather than guessing while it loads.
  const organizationsSettled = !organizationsQ.isPending;
  const organizationRefusal = !organizationsSettled
    ? null
    : organizationsQ.isError
      ? "The organization list could not be loaded, so this form cannot tell which tenant a new profile would belong to. Reload the page."
      : organizationOptions.length === 0
        ? "You administer no active organization, so there is no tenant to create a profile in."
        : effectiveOrganizationId === ""
          ? "Choose an organization. A profile always belongs to one."
          : null;

  // The severity map is one organization's, and the query key carries which —
  // without it, switching organizations would render the previous tenant's map
  // from cache. Disabled rather than sent blank: `resolveTargetOrg` answers an
  // unnamed organization with a 400, which is not an answer the operator asked
  // for.
  const defaultsQ = useQuery({
    queryKey: ["escalation", "defaults", effectiveOrganizationId],
    queryFn: () => fetchEscalationDefaults(effectiveOrganizationId),
    enabled: effectiveOrganizationId !== "",
  });

  const [severityMap, setSeverityMap] = useState<Record<string, string>>({});
  const [mapLoadedFor, setMapLoadedFor] = useState<string | null>(null);
  const loadedOrganizationId = defaultsQ.data?.organizationId ?? null;
  // Adjusted during render rather than in an effect, and keyed on the
  // organization the map came back FOR. A background refetch of the same
  // organization must not overwrite an edit in progress; a switch to another
  // organization must.
  if (loadedOrganizationId !== mapLoadedFor) {
    setMapLoadedFor(loadedOrganizationId);
    setSeverityMap(
      Object.fromEntries((defaultsQ.data?.items ?? []).map((item) => [item.severity, item.profileId])),
    );
  }

  const profiles = profilesQ.data?.items ?? [];
  const scopedProfiles = profiles.filter(
    (profile) => profile.organizationId === effectiveOrganizationId,
  );
  const severities = (vocabulariesQ.data?.alarmSeverities ?? []).filter((s) => s.active);
  const severityLabel = (code: string) =>
    severities.find((s) => s.code === code)?.label ?? code;

  // See the header, point 3: the organization's own channels and the fleet-wide ones.
  const channelsFor = (organizationId: string): NotificationChannelDto[] =>
    (channelsQ.data?.items ?? []).filter(
      (channel) => channel.organizationId === null || channel.organizationId === organizationId,
    );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteEscalationProfile(id),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["escalation", "profiles"] });
    },
    // A profile a severity still maps to comes back 409 with the reason. It is
    // rendered rather than swallowed: unmapping first is the operator's move.
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  // A severity left on `None` is ABSENT, not null — that is how the schema says
  // "this severity never escalates".
  const mappedItems = severities
    .filter((severity) => (severityMap[severity.code] ?? "") !== "")
    .map((severity) => ({ severity: severity.code, profileId: severityMap[severity.code] as string }));

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Escalation Profiles"
        subtitle="Who hears about an alarm next, when nobody acknowledges the first message"
      />

      {error ? (
        <div role="alert" className="rounded border border-critical-line bg-critical-wash px-3 py-2 text-sm text-critical-ink-strong">
          {error}
        </div>
      ) : null}

      <SectionCard title="Organization" bodyClassName="p-3 space-y-3">
        {/* The organization the severity map and a new profile belong to. A
            role with exactly one organization has no choice to make, so the
            control is disabled rather than hidden — hiding it would hide the
            tenant too. */}
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase text-ink-muted">Organization</span>
          <select
            className="w-full surface-field px-3 py-1.5 disabled:text-ink-muted"
            value={effectiveOrganizationId}
            disabled={organizationLocked}
            onChange={(event) => setChosenOrganizationId(event.target.value)}
          >
            {/* `""` matches no option otherwise and the control would render
                `selectedIndex = -1` — a picker showing the first organization
                while holding none. */}
            {!organizationLocked ? <option value="">Select organization</option> : null}
            {organizationOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </SectionCard>

      <SectionCard title="Profiles" bodyClassName="p-3 space-y-3">
        {profilesQ.isLoading ? <p className="text-sm text-ink-muted">Loading profiles…</p> : null}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Organization</th>
              <th className="px-2 py-2">Steps</th>
              <th className="px-2 py-2">Severities</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => {
              const mapped =
                profile.organizationId === loadedOrganizationId
                  ? (defaultsQ.data?.items ?? [])
                      .filter((item) => item.profileId === profile.id)
                      .map((item) => severityLabel(item.severity))
                  : [];
              return (
                <tr key={profile.id} className="border-b border-well-deep">
                  <td className="px-2 py-2 font-mono">{profile.code}</td>
                  <td className="px-2 py-2">{profile.name}</td>
                  <td className="px-2 py-2">
                    {organizationLabel(profile.organizationId, organizations)}
                  </td>
                  <td className="px-2 py-2">{profile.steps.length}</td>
                  <td className="px-2 py-2">{mapped.length > 0 ? mapped.join(", ") : "—"}</td>
                  <td className="px-2 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-xs font-semibold text-accent-strong"
                        onClick={() => {
                          setOpen({ kind: "edit", profile });
                          setError(null);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-critical-ink"
                        onClick={() => deleteMutation.mutate(profile.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!profilesQ.isLoading && profiles.length === 0 ? (
              <tr>
                <td className="px-2 py-3 text-ink-muted" colSpan={6}>
                  No escalation profiles yet. An unacknowledged alarm goes no further than the
                  message its rule already sent.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {/* The reason travels with the disabled control: a greyed-out button
            that says nothing leaves the operator with no move to make. */}
        {organizationRefusal ? <p className="text-xs text-ink-muted">{organizationRefusal}</p> : null}
        <button
          type="button"
          className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:bg-line-strong"
          disabled={organizationRefusal !== null || !organizationsSettled}
          aria-busy={organizationsQ.isPending}
          onClick={() => {
            setOpen({ kind: "create" });
            setError(null);
          }}
        >
          {organizationsQ.isPending ? "Loading organizations…" : "Add profile"}
        </button>
      </SectionCard>

      <SectionCard title="Severity map" bodyClassName="p-3 space-y-3">
        <p className="text-xs text-ink-muted">
          Which ladder an unacknowledged alarm climbs, by severity. A severity left on None never
          escalates.
        </p>
        {effectiveOrganizationId === "" ? (
          <p className="text-sm text-ink-muted">
            Choose an organization to see its severity map. The map belongs to one organization,
            and there is no fleet-wide one.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {severities.map((severity) => (
                <label key={severity.code} className="text-sm">
                  <span className="block text-xs font-semibold uppercase text-ink-muted">
                    {severity.label}
                  </span>
                  <select
                    className="w-full surface-field px-3 py-1.5"
                    value={severityMap[severity.code] ?? ""}
                    onChange={(event) =>
                      setSeverityMap({ ...severityMap, [severity.code]: event.target.value })
                    }
                  >
                    <option value="">None</option>
                    {scopedProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.code} — {profile.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              type="button"
              className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:bg-line-strong"
              disabled={defaultsQ.isLoading}
              onClick={() => setOpen({ kind: "defaults" })}
            >
              Save severity map
            </button>
          </>
        )}
      </SectionCard>

      {open?.kind === "create" || open?.kind === "edit" ? (
        <EscalationProfileWizard
          profile={open.kind === "edit" ? open.profile : null}
          organizationId={open.kind === "edit" ? open.profile.organizationId : effectiveOrganizationId}
          organizationName={organizationLabel(
            open.kind === "edit" ? open.profile.organizationId : effectiveOrganizationId,
            organizations,
          )}
          channels={channelsFor(open.kind === "edit" ? open.profile.organizationId : effectiveOrganizationId)}
          onCancel={() => setOpen(null)}
          onDone={async () => {
            setOpen(null);
            setError(null);
            await queryClient.invalidateQueries({ queryKey: ["escalation", "profiles"] });
          }}
        />
      ) : null}
      {open?.kind === "defaults" ? (
        <EscalationDefaultsWizard
          organizationId={effectiveOrganizationId}
          organizationName={organizationLabel(effectiveOrganizationId, organizations)}
          items={mappedItems}
          severityLabel={severityLabel}
          profileLabel={(id) => scopedProfiles.find((profile) => profile.id === id)?.code ?? id}
          onCancel={() => setOpen(null)}
          onDone={async () => {
            setOpen(null);
            setError(null);
            // The prefix, deliberately: the key carries the organization, and every
            // organization's cached map is stale once one of them is written by a
            // role that may hold several.
            await queryClient.invalidateQueries({ queryKey: ["escalation", "defaults"] });
          }}
        />
      ) : null}
    </MasterDataLayout>
  );
}
