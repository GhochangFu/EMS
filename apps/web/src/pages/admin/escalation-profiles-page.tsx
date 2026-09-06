import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { EscalationProfileDto, NotificationChannelDto } from "@bms/shared";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  createEscalationProfile,
  deleteEscalationProfile,
  fetchEscalationDefaults,
  fetchEscalationProfiles,
  setEscalationDefaults,
  updateEscalationProfile,
  type EscalationStepPayload,
} from "../../api/escalation";
import { fetchNotificationChannels } from "../../api/notifications";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { channelOrganizationOptions, organizationLabel } from "../../lib/notification-channels";
import type { AuthUser } from "../../stores/auth-store";

type EscalationProfilesPageProps = { user: AuthUser };

/** One rung, as the form holds it: the minutes stay text until they are sent. */
type StepForm = { afterMinutes: string; channelIds: string[] };
type ProfileForm = { code: string; name: string; organizationId: string; steps: StepForm[] };

function blankProfileForm(): ProfileForm {
  return { code: "", name: "", organizationId: "", steps: [] };
}

function formFromProfile(profile: EscalationProfileDto): ProfileForm {
  return {
    code: profile.code,
    name: profile.name,
    organizationId: profile.organizationId,
    steps: profile.steps.map((step) => ({
      afterMinutes: String(step.afterMinutes),
      channelIds: [...step.channelIds],
    })),
  };
}

/**
 * Review 3: a blank or non-numeric delay is refused at the field, so it never
 * reaches the payload. It used to be mapped to `0` for the server to refuse;
 * that turned an empty box into a number that was never typed, and the
 * message it earned ("greater than or equal to 1") described a value the
 * operator never entered. Only the numeric shape is checked here: the
 * 1–10 080 bound and the ladder's ordering stay the server's, so those
 * messages reach the screen unchanged.
 */
const STEP_DELAY_MESSAGE = "Enter the delay in minutes.";

function stepDelayInvalid(step: StepForm): boolean {
  const raw = step.afterMinutes.trim();
  return raw === "" || Number.isNaN(Number(raw));
}

/** `cannotSave` holds every step to {@link stepDelayInvalid}, so `Number` here is never `NaN`. */
function stepsToPayload(steps: StepForm[]): EscalationStepPayload[] {
  return steps.map((step) => ({
    afterMinutes: Number(step.afterMinutes.trim()),
    channelIds: step.channelIds,
  }));
}

/**
 * `F3.10` — escalation-profile administration (ADR 0057 decision 11, ruling Q5).
 *
 * No mockup covers this screen, so `notification-channels-page.tsx` is the §5
 * reference and this follows it: the same `MasterDataLayout`, the same list-then-
 * form shape, the same organization picker, the same one-`role="alert"` surface
 * for a server refusal. Three things differ, and each is a consequence of the
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
  const [form, setForm] = useState<ProfileForm>(blankProfileForm());
  const [editing, setEditing] = useState<EscalationProfileDto | null>(null);
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
    : form.organizationId;

  // Create only, the channels page's rule: an existing profile already has an
  // organization, so a list that failed or came back empty must not block the
  // edit of a row that is on screen in front of the operator. The list decides
  // it, so the form waits for the list rather than guessing while it loads.
  const organizationsSettled = !organizationsQ.isPending;
  const organizationRefusal = !(editing === null && organizationsSettled)
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
  // organization must. An effect on `defaultsQ.data` would get the first case
  // wrong, which is the edit an operator loses without ever seeing why.
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

  // See the header, point 3.
  const channels: NotificationChannelDto[] = (channelsQ.data?.items ?? []).filter(
    (channel) =>
      channel.organizationId === null || channel.organizationId === effectiveOrganizationId,
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        // Neither `code` nor `organizationId`: `updateEscalationProfileBodySchema`
        // carries neither, and the patch type refuses them at compile time.
        return updateEscalationProfile({
          id: editing.id,
          patch: { name: form.name, steps: stepsToPayload(form.steps) },
        });
      }
      return createEscalationProfile({
        organizationId: effectiveOrganizationId,
        code: form.code,
        name: form.name,
        steps: stepsToPayload(form.steps),
      });
    },
    onSuccess: async () => {
      setForm(blankProfileForm());
      setEditing(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["escalation", "profiles"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteEscalationProfile(id),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["escalation", "profiles"] });
    },
    // A profile a severity still maps to comes back 409 with the reason. It is
    // rendered rather than swallowed: unmapping first is the operator's move.
    onError: (err: Error) => setError(err.message),
  });

  const defaultsMutation = useMutation({
    mutationFn: () =>
      setEscalationDefaults({
        organizationId: effectiveOrganizationId,
        // A severity left on `None` is ABSENT, not null — that is how the
        // schema says "this severity never escalates", and sending it with an
        // empty id would be a shape error instead.
        items: severities
          .filter((severity) => (severityMap[severity.code] ?? "") !== "")
          .map((severity) => ({
            severity: severity.code,
            profileId: severityMap[severity.code] as string,
          })),
      }),
    onSuccess: async () => {
      setError(null);
      // The prefix, deliberately: the key carries the organization, and every
      // organization's cached map is stale once one of them is written by a
      // role that may hold several.
      await queryClient.invalidateQueries({ queryKey: ["escalation", "defaults"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  // Deliberately narrow, and it does NOT include the ladder's own rules. A
  // client that refused an out-of-order ladder here would keep the server's
  // message — the one that names the bound — off the screen for ever. The one
  // per-step check is the numeric SHAPE of the delay (`stepDelayInvalid`): a
  // non-number cannot be sent at all, so there is no server message to keep.
  const cannotSave =
    saveMutation.isPending ||
    organizationRefusal !== null ||
    (editing === null && !organizationsSettled) ||
    form.steps.some(stepDelayInvalid);

  const updateStep = (index: number, patch: Partial<StepForm>) =>
    setForm({
      ...form,
      steps: form.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    });

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Escalation Profiles"
        subtitle="Who hears about an alarm next, when nobody acknowledges the first message"
      />

      {error ? (
        <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <SectionCard title="Profiles" bodyClassName="p-3 space-y-3">
        {profilesQ.isLoading ? <p className="text-sm text-bms-muted">Loading profiles…</p> : null}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-bms-muted">
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
              // Only the organization whose map is loaded can say which
              // severities route here. See the header, point 2.
              const mapped =
                profile.organizationId === loadedOrganizationId
                  ? (defaultsQ.data?.items ?? [])
                      .filter((item) => item.profileId === profile.id)
                      .map((item) => severityLabel(item.severity))
                  : [];
              return (
                <tr key={profile.id} className="border-b border-gray-100">
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
                        className="text-xs font-semibold text-bms-green"
                        onClick={() => {
                          setEditing(profile);
                          setForm(formFromProfile(profile));
                          setError(null);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-red-700"
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
                <td className="px-2 py-3 text-bms-muted" colSpan={6}>
                  No escalation profiles yet. An unacknowledged alarm goes no further than the
                  message its rule already sent.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard title="Severity map" bodyClassName="p-3 space-y-3">
        <p className="text-xs text-bms-muted">
          Which ladder an unacknowledged alarm climbs, by severity. A severity left on None never
          escalates.
        </p>
        {effectiveOrganizationId === "" ? (
          <p className="text-sm text-bms-muted">
            Choose an organization to see its severity map. The map belongs to one organization,
            and there is no fleet-wide one.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {severities.map((severity) => (
                <label key={severity.code} className="text-sm">
                  <span className="block text-xs font-semibold uppercase text-bms-muted">
                    {severity.label}
                  </span>
                  <select
                    className="w-full rounded border px-3 py-1.5"
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
              className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white disabled:bg-gray-300"
              disabled={defaultsMutation.isPending || defaultsQ.isLoading}
              onClick={() => defaultsMutation.mutate()}
            >
              Save severity map
            </button>
          </>
        )}
      </SectionCard>

      <SectionCard
        title={editing ? `Edit ${editing.code}` : "Add a profile"}
        bodyClassName="p-3 space-y-3"
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase text-bms-muted">Code</span>
              <input
                className="w-full rounded border px-3 py-1.5"
                value={form.code}
                disabled={editing !== null}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase text-bms-muted">Name</span>
              <input
                className="w-full rounded border px-3 py-1.5"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            {/* Disabled while editing rather than hidden, the channels page's
                reason: a profile cannot change organization, and the operator
                must still see whose profile they are editing. */}
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase text-bms-muted">
                Organization
              </span>
              <select
                className="w-full rounded border px-3 py-1.5 disabled:bg-gray-50 disabled:text-bms-muted"
                value={editing ? form.organizationId : effectiveOrganizationId}
                disabled={editing !== null || organizationLocked}
                onChange={(event) => setForm({ ...form, organizationId: event.target.value })}
              >
                {editing ? (
                  <option value={form.organizationId}>
                    {organizationLabel(editing.organizationId, organizations)}
                  </option>
                ) : (
                  <>
                    {/* Rendered for every unlocked role, `admin` included: with
                        no fleet-wide entry, `""` matches no option and the
                        control would otherwise render `selectedIndex = -1` — a
                        picker showing the first organization while holding
                        none. */}
                    {!organizationLocked ? <option value="">Select organization</option> : null}
                    {organizationOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-bms-muted">Steps</p>
            {form.steps.length === 0 ? (
              <p className="text-xs text-bms-muted">
                No steps yet. A profile with no ladder is legal — it escalates nothing until you
                add one.
              </p>
            ) : null}
            {form.steps.map((step, index) => (
              // A `fieldset` per rung: the legend names the step, so the group
              // is addressable by what it says rather than by where it sits.
              <fieldset key={index} className="rounded border border-gray-200 px-3 py-2">
                <legend className="px-1 text-xs font-semibold uppercase text-bms-muted">
                  Step {index + 1}
                </legend>
                <label className="text-sm">
                  <span className="block text-xs font-semibold uppercase text-bms-muted">
                    After (minutes)
                  </span>
                  <input
                    className="w-40 rounded border px-3 py-1.5"
                    inputMode="numeric"
                    value={step.afterMinutes}
                    onChange={(event) => updateStep(index, { afterMinutes: event.target.value })}
                  />
                </label>
                {/* A sibling of the label, not a child: inside it the text would
                    join the field's accessible name. */}
                {stepDelayInvalid(step) ? (
                  <p className="mt-1 text-xs text-amber-900">{STEP_DELAY_MESSAGE}</p>
                ) : null}
                <p className="mt-2 text-xs font-semibold uppercase text-bms-muted">Channels</p>
                {channels.length === 0 ? (
                  <p className="mt-1 text-xs text-bms-muted">
                    No channels you can use here. Create one under Admin → Notifications.
                  </p>
                ) : null}
                <div className="mt-1 space-y-1">
                  {channels.map((channel) => {
                    const inputId = `step-${index}-channel-${channel.id}`;
                    return (
                      <label
                        key={channel.id}
                        htmlFor={inputId}
                        className="flex items-center gap-2 text-xs text-bms-ink"
                      >
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={step.channelIds.includes(channel.id)}
                          onChange={() =>
                            updateStep(index, {
                              channelIds: step.channelIds.includes(channel.id)
                                ? step.channelIds.filter((id) => id !== channel.id)
                                : [...step.channelIds, channel.id],
                            })
                          }
                        />
                        {channel.enabled ? channel.name : `${channel.name} (disabled)`}
                      </label>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-red-700"
                  onClick={() =>
                    setForm({ ...form, steps: form.steps.filter((_, i) => i !== index) })
                  }
                >
                  Remove step
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-xs font-semibold"
              onClick={() =>
                setForm({ ...form, steps: [...form.steps, { afterMinutes: "", channelIds: [] }] })
              }
            >
              Add step
            </button>
          </div>

          {/* The reason travels with the disabled control, the channels page's
              rule: a greyed-out submit that says nothing leaves the operator
              with no move to make. */}
          {organizationRefusal ? (
            <p className="text-xs text-bms-muted">{organizationRefusal}</p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white disabled:bg-gray-300"
              disabled={cannotSave}
            >
              {editing ? "Save changes" : "Add profile"}
            </button>
            {editing ? (
              <button
                type="button"
                className="rounded border px-3 py-2 text-xs font-semibold"
                onClick={() => {
                  setEditing(null);
                  setForm(blankProfileForm());
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </SectionCard>
    </MasterDataLayout>
  );
}
