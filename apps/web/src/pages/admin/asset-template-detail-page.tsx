/**
 * The template detail shell (`F2.5`, ADR 0038 decisions 2, 3 and 10 — Unit 7).
 *
 * This file owns the **chrome**, not the content: the lifecycle state, the
 * action buttons, the two error surfaces, and the tab strip. Each of the five
 * tab bodies is a separate component (Unit 9), so that five tabs can be built
 * in parallel — five tabs inside one page file parallelises nothing.
 *
 * ## The two things that can go wrong, and where each is shown
 *
 * ADR 0038 decision 10 splits authorisation in two, and only one half is
 * answerable here:
 *
 * - **Role.** `location_admin` cannot author. That is a pure role check on
 *   `user.role`, so the authoring buttons are simply **not rendered**.
 *   Instantiate stays — a location admin deploys.
 * - **Organization scope.** Not derivable in the browser:
 *   `accessibleScopeSchema` carries no organization list. This case falls
 *   through to the API's 403.
 *
 *   **There are three sentences behind that 403, not one, and this docblock
 *   used to name only the middle one.** They come from three different
 *   guards in `asset-templates.service.ts`:
 *
 *   - **Reading** a template outside your scope — `getById`'s
 *     `canManageOrganization` check — is *"Template is outside your access
 *     scope"*. This is the residual case ADR 0038 decision 10 describes, and
 *     it is the **only** one reachable here by opening a URL, because `list()`
 *     filters to `writableOrganizationIds` and never offers the row.
 *   - **Writing** anything outside your scope — `assertCanAuthor`'s
 *     `canManageTemplate` check — is *"Organization is outside your access
 *     scope"*. That is the sentence decision 10 quotes, and it is correct
 *     **for a write**.
 *   - A `location_admin` attempting to author is *"Location admins cannot
 *     author asset templates"*, before organization scope is consulted at all.
 *
 *   Confirmed against the running stack on 2026-08-21 from both roles. Anyone
 *   testing the read case against the documented wording would have looked
 *   for a string that path never produces.
 *
 *   **This used to say `adminFetch` "throws it unwrapped", and that was
 *   false.** It throws `new Error(text)` with the *whole* body, so the section
 *   7 browser pass showed an author
 *   `{"message":"A template with no points…","error":"Bad Request","statusCode":400}`
 *   instead of the sentence. Every error surface on this screen now goes
 *   through `apiErrorMessage`. The other admin pages still render the raw
 *   envelope — fixing `adminFetch` itself would change 42 call sites and is a
 *   decision to make on purpose, not as a side effect of this item.
 *
 * The third surface is not an authorisation failure at all: a row written
 * before ADR 0019 can be **read and not written back**, because
 * `templateContentSchema` pipes into a `.strict()` envelope. `unwritableContentKeys`
 * names those keys up front, so an author learns it before filling in a form
 * rather than from a 400 listing a key they never typed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { AdminAssetTemplateDto } from "@bms/shared";

import {
  archiveAdminAssetTemplate,
  createDraftFromAdminAssetTemplate,
  deleteAdminAssetTemplateDraft,
  fetchAdminAssetTemplate,
  instantiateFromAdminAssetTemplate,
  publishAdminAssetTemplate,
} from "../../api/admin/asset-templates";
import {
  HierarchyFilterBar,
  type HierarchySelection,
} from "../../components/admin/hierarchy-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { apiErrorMessage } from "../../lib/api-error-message";
import { AlarmsTab } from "../../components/asset-templates/alarms-tab";
import { CalculationsTab } from "../../components/asset-templates/calculations-tab";
import { DashboardsTab } from "../../components/asset-templates/dashboards-tab";
import { DetailsTab } from "../../components/asset-templates/details-tab";
import { KpisTab } from "../../components/asset-templates/kpis-tab";
import { PointsTab } from "../../components/asset-templates/points-tab";
import { TemplateTabStrip } from "../../components/asset-templates/template-tab-strip";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { unwritableContentKeys } from "../../lib/template-content-merge";
import {
  buildInstantiatePayload,
  hasTarget,
  namedCount,
} from "../../lib/template-instantiate-form";
import { guardLifecycleAction, guardTabSwitch } from "../../lib/template-tab-guard";
import { resolveTemplateTab, type TemplateTabId } from "../../lib/template-tabs";
import {
  capabilities,
  statusTone,
  type TemplateLifecycleAction,
} from "../../lib/template-lifecycle";
import {
  canAuthorTemplates,
  canInstantiateTemplates,
  templateFormsAreEditable,
} from "../../lib/template-authoring-access";
import type { AuthUser } from "../../stores/auth-store";

type AssetTemplateDetailPageProps = { user: AuthUser };

/**
 * What each action's button says.
 *
 * `createDraft` is one call with two meanings, which is why the label is
 * resolved here and not in `template-lifecycle.ts`: on a published version it
 * is "Edit this version" (ADR 0038 decision 3), and on an archived one it is
 * "Revive as a new draft" (Amendment 3). The same `POST /:id/draft` either way.
 */
function actionLabel(action: TemplateLifecycleAction, status: string): string {
  if (action === "createDraft") {
    return status === "archived" ? "Revive as a new draft" : "Edit this version";
  }
  if (action === "delete") {
    return "Delete draft";
  }
  return action === "publish" ? "Publish" : action === "archive" ? "Archive" : "Instantiate";
}

/** Admin screen for one asset template version. */
export function AssetTemplateDetailPage({ user }: AssetTemplateDetailPageProps) {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [actionError, setActionError] = useState<string | null>(null);
  const [instantiateOpen, setInstantiateOpen] = useState(false);

  const templateQ = useQuery({
    queryKey: ["admin", "asset-template", templateId],
    queryFn: () => fetchAdminAssetTemplate(templateId ?? ""),
    enabled: Boolean(templateId),
  });

  const tab = resolveTemplateTab(searchParams.get("tab"));

  // Set by whichever tab is open, through `onDirtyChange`. The page cannot
  // work this out for itself — each tab owns its own form state, and that is
  // the whole reason switching tabs used to discard it.
  const [tabDirty, setTabDirty] = useState(false);

  // One pending thing, not two. A tab switch and a lifecycle action raise the
  // same dialog for the same reason, and two independent flags could both be
  // set — which would render two overlays.
  const [pending, setPending] = useState<
    { kind: "tab"; tab: TemplateTabId } | { kind: "action"; action: TemplateLifecycleAction } | null
  >(null);

  function openTab(next: TemplateTabId) {
    // The outgoing tab's dirty report belongs to a component that is about to
    // unmount. Clearing it here stops the incoming tab inheriting a `true` it
    // never set, which would prompt on the very next switch with nothing
    // unsaved.
    setTabDirty(false);
    setPending(null);
    setSearchParams({ tab: next }, { replace: true });
  }

  function selectTab(next: TemplateTabId) {
    const decision = guardTabSwitch(tab, next, tabDirty);
    if (decision.allow) {
      openTab(next);
      return;
    }
    setPending({ kind: "tab", tab: next });
  }

  function afterChange(next: AdminAssetTemplateDto) {
    setActionError(null);
    void queryClient.invalidateQueries({ queryKey: ["admin", "asset-templates"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "asset-template"] });
    // A new draft is a **different row** at a higher version, so the page must
    // move to it. Staying would leave the author editing the version they just
    // copied, with their changes going nowhere.
    if (next.id !== templateId) {
      navigate(`/admin/asset-templates/${next.id}`);
    }
  }

  const onActionError = (cause: Error) => setActionError(apiErrorMessage(cause));

  const publishM = useMutation({
    mutationFn: () => publishAdminAssetTemplate(templateId ?? ""),
    onSuccess: afterChange,
    onError: onActionError,
  });
  const archiveM = useMutation({
    mutationFn: () => archiveAdminAssetTemplate(templateId ?? ""),
    onSuccess: afterChange,
    onError: onActionError,
  });
  const draftM = useMutation({
    mutationFn: () => createDraftFromAdminAssetTemplate(templateId ?? ""),
    onSuccess: afterChange,
    onError: onActionError,
  });
  const deleteM = useMutation({
    mutationFn: () => deleteAdminAssetTemplateDraft(templateId ?? ""),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "asset-templates"] });
      navigate("/admin/asset-templates");
    },
    onError: onActionError,
  });

  if (templateQ.isPending) {
    return (
      <MasterDataLayout user={user}>
        <p className="p-4 text-sm text-bms-muted">Loading template…</p>
      </MasterDataLayout>
    );
  }

  if (templateQ.isError || !templateQ.data) {
    // The 403 half of decision 10 lands here, and D10 asks for **the message**
    // the service writes — not the envelope around it. `adminFetch` throws
    // `new Error(text)` with the whole body, so rendering `.message` raw put
    // `{"message":"Template is outside your access scope","error":"Forbidden",
    // "statusCode":403}` on screen. `apiErrorMessage` unwraps it, exactly as
    // the five tab save paths already do.
    //
    // This was invisible until `F4.52`: the branch could not run, because a
    // 403 cleared the session and returned the user to /login before any
    // message could render. Measured as `phe-admin@bms.local` opening an
    // out-of-scope template by URL, which is the only route to it — `list()`
    // filters to `writableOrganizationIds` and never offers the row.
    return (
      <MasterDataLayout user={user}>
        <SectionCard title="Asset template">
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {templateQ.error
              ? apiErrorMessage(templateQ.error)
              : "This template could not be loaded."}
          </p>
          <Link
            to="/admin/asset-templates"
            className="mt-3 inline-block text-xs font-semibold text-bms-green hover:underline"
          >
            Back to all templates
          </Link>
        </SectionCard>
      </MasterDataLayout>
    );
  }

  const template = templateQ.data;
  const lifecycle = capabilities(template.status);
  const mayAuthor = canAuthorTemplates(user.role);
  const mayInstantiate = canInstantiateTemplates(user.role);
  const blockedKeys = unwritableContentKeys(template.content);

  const runners: Record<TemplateLifecycleAction, () => void> = {
    publish: () => publishM.mutate(),
    archive: () => archiveM.mutate(),
    createDraft: () => draftM.mutate(),
    delete: () => deleteM.mutate(),
    instantiate: () => setInstantiateOpen(true),
  };

  // These buttons sit **above** the tabs, and on a draft — the only status
  // where the tabs are editable — Publish and Delete are exactly the two
  // offered. Neither used to consult `tabDirty`, so Publish shipped the stored
  // version while the screen kept showing the author's unsaved one, with no
  // message. Unlike a discard, nothing on screen indicated it had happened.
  function runAction(action: TemplateLifecycleAction) {
    const decision = guardLifecycleAction(action, tab, tabDirty);
    if (decision.allow) {
      runners[action]();
      return;
    }
    setPending({ kind: "action", action });
  }

  // Recomputed rather than stored, so the dialog cannot outlive the decision
  // that opened it — a stale prompt naming the wrong tab or action is worse
  // than none.
  const pendingDecision = !pending
    ? null
    : pending.kind === "tab"
      ? guardTabSwitch(tab, pending.tab, tabDirty)
      : guardLifecycleAction(pending.action, tab, tabDirty);

  function confirmPending() {
    if (!pending) {
      return;
    }
    if (pending.kind === "tab") {
      openTab(pending.tab);
      return;
    }
    // **`tabDirty` is deliberately NOT cleared here.** An earlier version did,
    // reasoning that the author had accepted the discard — and that disarmed
    // the guard for an action that then *failed*. Measured on the running
    // stack: publishing a draft with no points is refused by the server with a
    // 400, the edit is still on screen, but the page believed it was clean and
    // the next tab click discarded it silently. That is the exact defect the
    // guard exists to prevent, reintroduced by the guard's own confirm path.
    //
    // The open tab keeps reporting the truth instead. On a *successful*
    // action the status changes, each tab's reseed effect refires, and the
    // dirty flag clears because the form genuinely matches what is stored.
    setPending(null);
    runners[pending.action]();
  }
  const busy =
    publishM.isPending || archiveM.isPending || draftM.isPending || deleteM.isPending;

  const actions = lifecycle.actions.filter((action) =>
    action === "instantiate" ? mayInstantiate : mayAuthor,
  );

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow={`${template.organizationCode} · ${template.code}`}
        title={`${template.name} · v${template.version}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill label={template.status} tone={statusTone(template.status)} />
            <span>
              {template.assetType} · {template.domain} · {template.points.length} points
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              to="/admin/asset-templates"
              className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-muted"
            >
              All templates
            </Link>
            {/* `F2.6` (ADR 0039 decision 8). In the page chrome, not a seventh
                tab: ADR 0038 names exactly six and `tests/adr-0038-template-
                authoring-ui.test.ts` keeps it that way (D-3). Migration is also
                not authoring — it acts on assets, and the six tabs are all
                about this template's own shape. That second reason is the
                load-bearing one and it did not change when `F3.1e` added the
                sixth tab. */}
            <Link
              to={`/admin/asset-templates/${template.id}/versions`}
              className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-muted"
            >
              Versions &amp; migration
            </Link>
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                disabled={busy}
                onClick={() => runAction(action)}
                className={`rounded px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
                  action === "delete"
                    ? "border border-red-200 text-red-700"
                    : "bg-bms-green text-white"
                }`}
              >
                {actionLabel(action, template.status)}
              </button>
            ))}
          </div>
        }
      />

      {actionError ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </p>
      ) : null}

      {!lifecycle.editable ? (
        <p className="rounded border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
          This version is read-only. ADR 0015 freezes a template once it is published, so that
          assets built from it never change underneath.{" "}
          {mayAuthor
            ? template.status === "archived"
              ? "Revive it as a new draft to carry the model forward."
              : "Edit this version to open a new draft."
            : ""}
        </p>
      ) : null}

      {/* The other reason a tab renders read-only, and it needs its own
          sentence. Without one, a location admin opening an editable draft
          sees every field greyed with no explanation and no lifecycle button
          either, which reads as a broken page rather than as a boundary. */}
      {lifecycle.editable && !mayAuthor ? (
        <p className="rounded border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
          This is a draft, but your role does not author templates. You can read it and build
          assets from a published version. Ask a master-data administrator to change the model.
        </p>
      ) : null}

      {blockedKeys.length > 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">
            This template holds content that cannot be saved back.
          </p>
          <p className="mt-1">
            It reads and instantiates normally. Editing any tab that writes content will be
            refused until these are removed:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {blockedKeys.map((problem) => (
              <li key={problem.key}>{problem.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <SectionCard>
        <TemplateTabStrip active={tab} onSelect={selectTab} />
        <div className="pt-3">
          <TemplateTabBody
            tab={tab}
            template={template}
            // **Role AND status, not status alone.** `lifecycle.editable`
            // answers "is this version frozen"; it says nothing about who is
            // looking. Passing it alone rendered every authoring form fully
            // editable for a `location_admin`: they could fill in a whole
            // alarm set, press Save, and get a 403 — which `adminFetch` then
            // treated as an auth failure and cleared the session, so the work
            // was lost and they were returned to the login screen. Measured
            // on the running stack as `wc-admin@bms.local`, not reasoned about.
            // `F4.52` stopped the logout; this gate is what stops the wasted
            // work, and both are needed.
            //
            // ADR 0038 decision 10 says authoring is **role-hidden**. That was
            // applied to the lifecycle buttons and not to the tab bodies, so
            // half the decision shipped.
            editable={templateFormsAreEditable(user.role, lifecycle.editable)}
            onSaved={afterChange}
            onDirtyChange={setTabDirty}
          />
        </div>
      </SectionCard>

      {pending && pendingDecision && !pendingDecision.allow ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="tab-guard-title"
            className="w-full max-w-md space-y-3 rounded bg-white p-4 shadow-lg"
          >
            <h2 id="tab-guard-title" className="text-sm font-semibold text-bms-ink">
              Unsaved changes
            </h2>
            <p className="text-xs text-bms-muted">{pendingDecision.prompt}</p>
            <div className="flex justify-end gap-2">
              {/* Cancel first, and it is the plain-worded one. The destructive
                  choice sits on the right and names what it destroys. */}
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-muted"
              >
                {pendingDecision.cancelLabel}
              </button>
              <button
                type="button"
                onClick={confirmPending}
                className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                {pendingDecision.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {instantiateOpen ? (
        <InstantiateDialog
          user={user}
          template={template}
          onClose={() => setInstantiateOpen(false)}
        />
      ) : null}
    </MasterDataLayout>
  );
}

/**
 * Dispatches to one component per tab (Unit 9).
 *
 * **This function is the one file every sub-unit of Unit 9 must touch**, which
 * is why it became a real dispatcher with the first tab rather than waiting for
 * the last. The plan calls Unit 9 a fan-out point and says the five tabs are
 * "disjoint by construction"; they are not, because all five arrive here. With
 * the switch in place each tab was one arm plus its own new file.
 *
 * All five are built, and the last arm is an explicit comparison followed by an
 * exhaustiveness check rather than a bare fallback.
 *
 * **A bare fallback was written first, with a comment claiming a sixth tab
 * would fail to compile. It would not** — verified by widening
 * `TemplateTabId` and rebuilding: `tsc` exits 0 and the new tab silently
 * renders the Alarms editor. Narrowing to `"alarms" | "sixth"` is still
 * assignable to the fallback. The `never` assignment below is what makes the
 * claim true, and it is a compile-time complement to Unit 8's source scan:
 * that catches a change to the registry, this catches a change to the type.
 */
function TemplateTabBody({
  tab,
  template,
  editable,
  onSaved,
  onDirtyChange,
}: {
  tab: TemplateTabId;
  template: AdminAssetTemplateDto;
  editable: boolean;
  onSaved: (next: AdminAssetTemplateDto) => void;
  /**
   * Reported by the open tab whenever its form stops matching what is stored.
   * Required, not optional — a tab that forgot to report would silently lose
   * edits again, and an optional prop makes that omission compile.
   */
  onDirtyChange: (dirty: boolean) => void;
}) {
  if (tab === "details") {
    return (
      <DetailsTab
        template={template}
        editable={editable}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  if (tab === "points") {
    return (
      <PointsTab
        template={template}
        editable={editable}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  if (tab === "calculations") {
    return (
      <CalculationsTab
        template={template}
        editable={editable}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  if (tab === "kpis") {
    return (
      <KpisTab
        template={template}
        editable={editable}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  if (tab === "alarms") {
    return (
      <AlarmsTab
        template={template}
        editable={editable}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  if (tab === "dashboards") {
    return (
      <DashboardsTab
        template={template}
        editable={editable}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  // Unreachable while `TemplateTabId` names six tabs. Adding a seventh without
  // an arm here is a type error on this line, naming the tab that has no
  // editor — rather than a silent render of whichever arm came last.
  const unreachable: never = tab;
  return (
    <p className="rounded border border-dashed border-gray-300 p-4 text-xs text-bms-muted">
      The {String(unreachable)} editor is not wired up yet.
    </p>
  );
}

/**
 * Builds assets from this published version.
 *
 * The target is a location **or** an RTU, never both — `InstantiateAssetsInput`
 * is a union for that reason, and the server rejects both-or-neither in a
 * `superRefine`. `HierarchyFilterBar` supplies both pickers, seeded with the
 * template's own organization so the cascade cannot offer a target from
 * another one (which the server refuses: a template may not cross an org
 * boundary, because its point keys resolve against its own catalog).
 *
 * Instantiation is all-or-nothing. `skippedPoints` in the result names the
 * optional measured points whose `sourceDataKeyPattern` did not resolve —
 * surfaced because "12 points in, 10 rows out" is otherwise indistinguishable
 * from a defect.
 */
function InstantiateDialog({
  user,
  template,
  onClose,
}: {
  user: AuthUser;
  template: AdminAssetTemplateDto;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<HierarchySelection>({
    organizationId: template.organizationId,
  });
  const [rows, setRows] = useState([{ code: "", name: "" }]);
  const [error, setError] = useState<string | null>(null);

  const instantiateM = useMutation({
    mutationFn: () => {
      // Every rule — RTU-wins-over-location, dropping blank rows, and the
      // name-falls-back-to-code fallback — lives in
      // `lib/template-instantiate-form.ts` under test. Getting RTU-wins
      // backwards builds assets under the wrong parent with no error at all,
      // which is why it is not left inline here where nothing can reach it.
      const payload = buildInstantiatePayload(selection, rows);
      if (!payload.ok) {
        return Promise.reject(new Error(payload.message));
      }
      return instantiateFromAdminAssetTemplate(template.id, payload.input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
      onClose();
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  // Both read the same helpers the payload uses, so the button cannot promise
  // a count the body does not carry, and cannot enable itself for a target the
  // builder would refuse.
  const targetChosen = hasTarget(selection);
  const named = namedCount(rows);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-2xl space-y-3 rounded-lg bg-white p-4 shadow-lg">
        <h2 className="font-condensed text-base font-bold text-bms-ink">
          Instantiate {template.code} v{template.version}
        </h2>
        <p className="text-[11px] text-bms-muted">
          Each asset below is built with all {template.points.length} of this template&apos;s
          points. The whole batch succeeds or none of it does.
        </p>

        <HierarchyFilterBar
          user={user}
          levels={["location", "rtu"]}
          selection={selection}
          onNavigate={(next) => setSelection({ ...next, organizationId: template.organizationId })}
          syncRoutes={false}
        />

        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="flex gap-2">
              <input
                value={row.code}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((item, position) =>
                      position === index ? { ...item, code: event.target.value } : item,
                    ),
                  )
                }
                placeholder="Asset code"
                aria-label={`Asset ${index + 1} code`}
                className="w-1/3 rounded border border-gray-200 px-2 py-1 text-xs"
              />
              <input
                value={row.name}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((item, position) =>
                      position === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
                placeholder="Asset name (defaults to the code)"
                aria-label={`Asset ${index + 1} name`}
                className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows((current) => [...current, { code: "", name: "" }])}
            className="text-xs font-semibold text-bms-green hover:underline"
          >
            Add another asset
          </button>
        </div>

        {error ? (
          <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!targetChosen || named === 0 || instantiateM.isPending}
            onClick={() => {
              setError(null);
              instantiateM.mutate();
            }}
            className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {instantiateM.isPending ? "Building…" : `Build ${named} asset${named === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
