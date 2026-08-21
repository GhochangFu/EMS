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
 *   through to the API's 403 and its body is rendered verbatim. The service
 *   already writes the right sentence ("Organization is outside your access
 *   scope"), and `adminFetch` throws it unwrapped for exactly this reason.
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
import { TemplateTabStrip } from "../../components/asset-templates/template-tab-strip";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { unwritableContentKeys } from "../../lib/template-content-merge";
import { resolveTemplateTab, type TemplateTabId } from "../../lib/template-tabs";
import {
  capabilities,
  statusTone,
  type TemplateLifecycleAction,
} from "../../lib/template-lifecycle";
import {
  canAuthorTemplates,
  canInstantiateTemplates,
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
  function selectTab(next: TemplateTabId) {
    setSearchParams({ tab: next }, { replace: true });
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

  const onActionError = (cause: Error) => setActionError(cause.message);

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
    // The 403 half of decision 10 lands here. The body is rendered verbatim
    // because the service's own sentence is the actionable one.
    return (
      <MasterDataLayout user={user}>
        <SectionCard title="Asset template">
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {(templateQ.error as Error | null)?.message ?? "This template could not be loaded."}
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
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                disabled={busy}
                onClick={runners[action]}
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
          <TemplateTabBody tab={tab} />
        </div>
      </SectionCard>

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
 * The tab bodies land in Unit 9, one component per tab.
 *
 * A named placeholder rather than an empty div: the shell, the registry, the
 * routes and the lifecycle chrome are what Unit 7 delivers, and every later
 * unit hangs off them. Rendering nothing here would make the shell look broken
 * while it is in fact complete.
 */
function TemplateTabBody({ tab }: { tab: TemplateTabId }) {
  return (
    <p className="rounded border border-dashed border-gray-300 p-4 text-xs text-bms-muted">
      The {tab} editor is not wired up yet.
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
      const assets = rows
        .filter((row) => row.code.trim() !== "")
        .map((row) => ({ code: row.code.trim(), name: row.name.trim() || row.code.trim() }));
      // RTU wins when both pickers are set: an RTU already implies its
      // location, so sending both would be the both-or-neither case the server
      // rejects.
      return selection.rtuId
        ? instantiateFromAdminAssetTemplate(template.id, { rtuId: selection.rtuId, assets })
        : instantiateFromAdminAssetTemplate(template.id, {
            locationId: selection.locationId ?? "",
            assets,
          });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
      onClose();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const targetChosen = Boolean(selection.rtuId ?? selection.locationId);
  const named = rows.filter((row) => row.code.trim() !== "").length;

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
