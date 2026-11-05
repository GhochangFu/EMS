import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  MimicLayoutDto,
  MimicLayoutWidgetNodesDto,
  MimicOrgSymbolDto,
  MimicSymbolLibrariesResponse,
  MimicSymbolLibrarySelection,
} from "@bms/shared";
import { MIMIC_LAYOUT_STALE_MESSAGE, mimicPresetSchema } from "@bms/shared/contracts";

import { createMimicLayout, fetchMimicLayout, replaceMimicLayout } from "../../api/mimic-layouts";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { MimicEditorCanvas } from "../../components/mimic-editor/canvas";
import { MimicEditorInspector } from "../../components/mimic-editor/inspector";
import { MimicEditorPalette } from "../../components/mimic-editor/palette";
import { MimicPreviewCanvas } from "../../components/mimic-editor/mimic-preview-canvas";
import { MimicPreviewInspector } from "../../components/mimic-editor/mimic-preview-inspector";
import { MimicPreviewPicker, type PreviewChoice } from "../../components/mimic-editor/preview-picker";
import { NO_STATE_MAPS } from "../../components/widgets/mimic-scene";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { mimicLayoutPreviewQueryKey, useMimicLayoutPreview } from "../../hooks/use-mimic-layout-preview";
import { useMimicSymbolLibraries } from "../../hooks/use-mimic-symbol-libraries";
import { useOrganizationChoice } from "../../hooks/use-organization-choice";
import { useSiteLiveReadings } from "../../hooks/use-site-live-readings";
import { canManageMimicLayouts } from "../../lib/admin-access";
import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";
import { mimicViewFor } from "../../lib/mimic";
import { layoutWarnings } from "../../lib/mimic-editor-warnings";
import { catalogOrgSymbols } from "../../lib/mimic-symbols";
import {
  editorReducer,
  emptyEditorLayout,
  fromPreset,
  hasUnsavedEdits,
  initialEditorState,
  keyboardAction,
  layoutFromDto,
  toWriteBody,
  type EditorLayout,
} from "../../lib/mimic-editor";
import type { AuthUser } from "../../stores/auth-store";
import { MIMIC_LAYOUTS_QUERY_KEY } from "./mimic-layouts-page";

type MimicLayoutEditorPageProps = { user: AuthUser };

/** The sentence a stale save shows. */
export const STALE_LAYOUT_BANNER = "This layout was changed by someone else since you opened it. Reload it and apply your edit again.";

/**
 * `F3.32c` U6c (ADR 0081 decisions 2, 3, 7) — the mimic layout editor.
 *
 * `/admin/mimic-layouts/new` draws a new layout (blank, or the preset copy with `?preset=<p>`,
 * decision 4 — any of the seven presets since ADR 0082 decision 5; an unknown `p` is blank) and
 * saves it with `POST` and the owning `organizationId`
 * (owner ruling OQ3), then moves to the saved layout's route. `/admin/mimic-layouts/:layoutId`
 * loads a stored layout and saves it with `PUT` and the `version` it was loaded at (decision 2):
 * a 409 means another save came first, and the page shows a Reload banner rather than a raw
 * error — reloading drops the unsaved edits, which is what the stale answer requires.
 *
 * Fails closed at the page for every role but `admin` and `organization_admin`, as
 * `mimic-layouts-page.tsx` does.
 */
export function MimicLayoutEditorPage({ user }: MimicLayoutEditorPageProps) {
  const { layoutId } = useParams<{ layoutId: string }>();
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration · Mimic Layouts"
        title={layoutId === undefined ? "New mimic layout" : "Edit mimic layout"}
        subtitle="Place units, panels and labels on the grid; join units with pipes; bind a unit to a role"
      />
      {canManageMimicLayouts(user.role) ? (
        layoutId === undefined ? (
          <NewLayoutEditor />
        ) : (
          <StoredLayoutEditor layoutId={layoutId} />
        )
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Mimic layouts are drawn by an administrator or an organization administrator.
        </p>
      )}
    </MasterDataLayout>
  );
}

function NewLayoutEditor() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organizations, organizationId, setOrganizationId } = useOrganizationChoice();
  // Any preset of the closed enum starts from its copy; an absent or unknown one is blank (plan D9).
  const preset = mimicPresetSchema.safeParse(searchParams.get("preset"));
  const initial = preset.success ? fromPreset(preset.data) : emptyEditorLayout();

  // The catalog of the chosen organization; no read starts until one is chosen.
  const catalogQ = useMimicSymbolLibraries(organizationId === "" ? undefined : organizationId, {
    enabled: organizationId !== "",
  });

  const saveM = useMutation({
    mutationFn: (layout: EditorLayout) => createMimicLayout({ ...toWriteBody(layout), organizationId }),
    onSuccess: async (saved: MimicLayoutDto) => {
      await queryClient.invalidateQueries({ queryKey: MIMIC_LAYOUTS_QUERY_KEY });
      // The saved layout IS its detail: cache it under the route this moves to, so the stored
      // editor opens on it at once rather than on a second read.
      queryClient.setQueryData(["mimic-layouts", saved.id], saved);
      void navigate(`/admin/mimic-layouts/${saved.id}`, { replace: true });
    },
  });

  return (
    <LayoutEditor
      initial={initial}
      saving={saveM.isPending}
      saveError={saveM.error === null ? null : apiErrorMessage(saveM.error)}
      stale={false}
      canSave={organizationId !== ""}
      onSave={(layout) => saveM.mutate(layout)}
      catalog={catalogQ.data ?? null}
      storedOrgSymbols={NO_ORG_SYMBOLS}
      storedLibraries={NO_LIBRARIES}
      saved={null}
      organization={{
        options: organizations.map((org) => ({ id: org.id, label: `${org.code} — ${org.name}` })),
        value: organizationId,
        onChange: setOrganizationId,
      }}
    />
  );
}

function StoredLayoutEditor({ layoutId }: { layoutId: string }) {
  const queryClient = useQueryClient();
  const [loadCount, setLoadCount] = useState(0);
  const [version, setVersion] = useState<number | null>(null);
  const [stale, setStale] = useState(false);

  const layoutQ = useQuery({
    queryKey: ["mimic-layouts", layoutId],
    queryFn: () => fetchMimicLayout(layoutId),
    refetchOnWindowFocus: false,
  });

  // The catalog of the layout's own organization, read once the layout is (before any early return).
  const layoutOrganizationId = layoutQ.data?.organizationId;
  const catalogQ = useMimicSymbolLibraries(layoutOrganizationId, { enabled: layoutOrganizationId !== undefined });

  // The version is taken at the FIRST load and at an explicit Reload only. A background refetch
  // that adopted a newer version would let the next PUT overwrite another author's save.
  useEffect(() => {
    if (layoutQ.data !== undefined && version === null) {
      setVersion(layoutQ.data.version);
    }
  }, [layoutQ.data, version]);

  const saveM = useMutation({
    mutationFn: (layout: EditorLayout) => replaceMimicLayout(layoutId, { ...toWriteBody(layout), version: version ?? 1 }),
    onSuccess: async (saved: MimicLayoutDto) => {
      setVersion(saved.version);
      setStale(false);
      // The detail cache takes the saved layout. Without it a reopened layout draws the
      // pre-save DTO and takes ITS version, and the next PUT answers a false stale 409.
      queryClient.setQueryData(["mimic-layouts", layoutId], saved);
      await queryClient.invalidateQueries({ queryKey: MIMIC_LAYOUTS_QUERY_KEY, exact: true });
      // F4.308 (plan C8): the preview draws the saved layout, so a save redraws it. Not awaited:
      // the save is done once the detail cache holds it; the preview refetches on its own time.
      void queryClient.invalidateQueries({ queryKey: mimicLayoutPreviewQueryKey(layoutId) });
    },
    onError: (cause: Error) => {
      // A PUT answers 409 for two reasons: a stale version, and a slug another layout of the
      // organization holds. Only the first needs a reload; the second is fixed by editing the
      // slug, so it is shown as an ordinary error and Save stays enabled.
      if (cause instanceof ApiError && cause.status === 409 && apiErrorMessage(cause) === MIMIC_LAYOUT_STALE_MESSAGE) {
        setStale(true);
      }
    },
  });

  async function reload(): Promise<void> {
    setStale(false);
    saveM.reset();
    const fresh = await layoutQ.refetch();
    if (fresh.data !== undefined) {
      setVersion(fresh.data.version);
    }
    setLoadCount((n) => n + 1);
  }

  if (layoutQ.isError) {
    return (
      <p role="alert" className="text-sm text-critical-ink">
        {apiErrorMessage(layoutQ.error)}
      </p>
    );
  }
  if (layoutQ.data === undefined) {
    return <p className="text-sm text-ink-muted">Loading the layout…</p>;
  }

  return (
    <>
      {stale ? (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 rounded border border-warning-line bg-warning-wash p-3 text-sm text-warning-ink">
          <span>{STALE_LAYOUT_BANNER}</span>
          <button
            type="button"
            onClick={() => void reload()}
            className="surface-button-primary bg-accent px-3 py-1 text-xs font-semibold text-on-accent"
          >
            Reload
          </button>
        </div>
      ) : null}
      <LayoutEditor
        key={`${layoutQ.data.id}:${loadCount}`}
        initial={layoutFromDto(layoutQ.data)}
        saving={saveM.isPending}
        saveError={saveM.error === null || stale ? null : apiErrorMessage(saveM.error)}
        stale={stale}
        canSave={version !== null}
        onSave={(layout) => saveM.mutate(layout)}
        catalog={catalogQ.data ?? null}
        storedOrgSymbols={layoutQ.data.orgSymbols}
        storedLibraries={layoutQ.data.symbolLibraries}
        saved={layoutQ.data}
      />
    </>
  );
}

/** A new layout embeds no organization symbol. */
const NO_ORG_SYMBOLS: readonly MimicOrgSymbolDto[] = [];

/** A new layout has no stored libraries, so the kept exemption covers none (review fix). */
const NO_LIBRARIES: readonly MimicSymbolLibrarySelection[] = [];

type LayoutEditorProps = {
  initial: EditorLayout;
  saving: boolean;
  saveError: string | null;
  stale: boolean;
  canSave: boolean;
  onSave: (layout: EditorLayout) => void;
  organization?: Parameters<typeof MimicEditorInspector>[0]["organization"];
  /** The organization's catalog, or `null` while it loads: the static tabs show meanwhile (R13). */
  catalog: MimicSymbolLibrariesResponse | null;
  /** The stored layout's embedded `orgSymbols` — its retired symbols included. */
  storedOrgSymbols: readonly MimicOrgSymbolDto[];
  /** The stored layout's `symbolLibraries`: the only non-live ones the inspector locks. */
  storedLibraries: readonly MimicSymbolLibrarySelection[];
  /**
   * `F4.308` — the last save (the detail cache, which a save replaces), which "Preview with site"
   * draws; `null` for a new layout, whose preview toggle is disabled.
   */
  saved: MimicLayoutDto | null;
};

/**
 * What the canvas draws organization units from: the stored layout's embedded symbols, then the
 * catalog's by key (the catalog is the fresher copy). A unit whose key neither holds draws the
 * fallback glyph.
 */
function mergeOrgSymbols(
  stored: readonly MimicOrgSymbolDto[],
  catalog: MimicSymbolLibrariesResponse | null,
): readonly MimicOrgSymbolDto[] {
  const byKey = new Map<string, MimicOrgSymbolDto>();
  for (const symbol of stored) byKey.set(symbol.key, symbol);
  for (const symbol of catalogOrgSymbols(catalog)) byKey.set(symbol.key, symbol);
  return [...byKey.values()];
}

function LayoutEditor({
  initial,
  saving,
  saveError,
  stale,
  canSave,
  onSave,
  organization,
  catalog,
  storedOrgSymbols,
  storedLibraries,
  saved,
}: LayoutEditorProps) {
  const [state, dispatch] = useReducer(editorReducer, initial, initialEditorState);
  const [pipeMode, setPipeMode] = useState(false);
  // F4.308 (ADR 0081 Amendment 2 decision 5) — while the preview is on, the editor is read-only.
  const [preview, setPreview] = useState<PreviewChoice | null>(null);
  const previewOn = preview !== null;
  // F4.308 review M1 — the preview read and its live overlay live HERE, so both cards and the
  // toolbar stay mounted in every mode (focus is kept on a pick). The socket opens only while a
  // group is chosen (`useSiteLiveReadings`' `enabled`); a new group is a new socket key.
  const previewGroupId = preview !== null && preview.groupId !== "" && saved !== null ? preview.groupId : null;
  const previewQ = useMimicLayoutPreview(saved?.id ?? "", previewGroupId);
  const previewEntry =
    previewGroupId === null
      ? undefined
      : previewQ.data?.widgets.find((w): w is MimicLayoutWidgetNodesDto => w.source === "layout");
  const previewResolvedAt = previewQ.data?.resolvedAt ?? "";
  const previewView = useMemo(() => mimicViewFor(previewEntry, previewResolvedAt), [previewEntry, previewResolvedAt]);
  const previewReadings = useSiteLiveReadings(
    `preview:${saved?.id ?? ""}:${previewGroupId ?? ""}`,
    previewView,
    previewQ.dataUpdatedAt,
    previewGroupId !== null,
  );
  const previewStateMaps = previewQ.data?.stateMaps ?? NO_STATE_MAPS;
  // The preview's own selection (`previewKey`), never the reducer's; it belongs to one group, so a
  // new group starts with none.
  const [previewPick, setPreviewPick] = useState<{ groupId: string | null; key: string | null }>({ groupId: null, key: null });
  const previewKey = previewPick.groupId === previewGroupId ? previewPick.key : null;
  const previewLabel = previewKey === null ? undefined : previewEntry?.layout.nodes.find((n) => n.key === previewKey)?.label;
  // Memoised: a new array each render would re-run the canvas's own geometry memo every time.
  const orgSymbols = useMemo(() => mergeOrgSymbols(storedOrgSymbols, catalog), [storedOrgSymbols, catalog]);

  // Keyboard (ADR 0081 decision 7). `keyboardAction` yields to inputs, selects and textareas,
  // so typing in the inspector never moves a node.
  // F4.308: no keyboard edit while the preview is on — the listener is not even registered.
  useEffect(() => {
    if (previewOn) {
      return undefined;
    }
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = keyboardAction(
        { key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, target },
        state,
      );
      if (action !== null) {
        event.preventDefault();
        dispatch(action);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, previewOn]);

  const warnings = useMemo(() => layoutWarnings(state.layout), [state.layout]);
  const selected = state.selected === null ? null : (state.layout.nodes.find((n) => n.key === state.selected) ?? null);

  const unsaved = previewOn && saved !== null && hasUnsavedEdits(state.layout, saved);

  const toolbar = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/admin/mimic-layouts" className="text-xs font-semibold text-accent-strong">
          Back to the library
        </Link>
        <button
          type="button"
          disabled={saving || stale || !canSave}
          aria-busy={saving}
          onClick={() => onSave(state.layout)}
          className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {saveError !== null ? (
        <p role="alert" className="text-xs text-critical-ink">
          {saveError}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <ul role="status" aria-label="Layout warnings" className="list-disc space-y-1 pl-4 text-xs text-warning-ink">
          {warnings.map((w) => (
            <li key={w.key}>{w.text}</li>
          ))}
        </ul>
      ) : null}
      <MimicPreviewPicker organizationId={saved?.organizationId ?? null} value={preview} onChange={setPreview} />
      {unsaved ? (
        <p role="status" className="text-xs text-warning-ink">
          Save to refresh the preview
        </p>
      ) : null}
    </>
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[14rem_minmax(0,1fr)_16rem]">
      <SectionCard title="Palette" bodyClassName="p-3">
        {previewOn ? (
          <p role="status" className="text-xs text-ink-muted">
            Preview is read-only. Turn it off to edit.
          </p>
        ) : (
          <MimicEditorPalette
            onAddUnit={(symbol, label) => dispatch({ type: "add-unit", symbol, label })}
            onAddPanel={() => dispatch({ type: "add-panel" })}
            onAddLabel={() => dispatch({ type: "add-label" })}
            pipeMode={pipeMode}
            onTogglePipeMode={() => setPipeMode((on) => !on)}
            canUndo={state.past.length > 0}
            canRedo={state.future.length > 0}
            onUndo={() => dispatch({ type: "undo" })}
            onRedo={() => dispatch({ type: "redo" })}
            canDelete={selected !== null}
            onDelete={() => dispatch({ type: "delete" })}
            libraries={state.layout.symbolLibraries}
            catalog={catalog}
          />
        )}
      </SectionCard>
      <SectionCard title={state.layout.name} bodyClassName="p-3 space-y-3">
        {toolbar}
        {!previewOn ? (
          <MimicEditorCanvas state={state} dispatch={dispatch} pipeMode={pipeMode} orgSymbols={orgSymbols} />
        ) : previewGroupId === null ? (
          <p className="text-sm text-ink-muted">Choose a site and an asset group to preview the saved layout.</p>
        ) : previewEntry !== undefined ? (
          <MimicPreviewCanvas
            entry={previewEntry}
            readings={previewReadings}
            stateMaps={previewStateMaps}
            selected={previewKey}
            onSelect={(key) => setPreviewPick({ groupId: previewGroupId, key })}
          />
        ) : previewQ.isError ? (
          <p role="alert" className="text-sm text-critical-ink">
            {apiErrorMessage(previewQ.error)}
          </p>
        ) : previewQ.data !== undefined ? (
          <p role="alert" className="text-sm text-critical-ink">
            The preview could not be drawn.
          </p>
        ) : (
          <p className="text-sm text-ink-muted">Loading the preview…</p>
        )}
      </SectionCard>
      <SectionCard title="Inspector" bodyClassName="p-3">
        {previewOn ? (
          <MimicPreviewInspector
            selection={
              previewKey === null || previewLabel === undefined
                ? null
                : { label: previewLabel, node: previewEntry?.nodes.find((n) => n.key === previewKey) }
            }
            readings={previewReadings}
            stateMaps={previewStateMaps}
          />
        ) : (
          <MimicEditorInspector
            layout={state.layout}
            selected={selected}
            onLayoutChange={(patch) => dispatch({ type: "update-layout", patch })}
            onNodeChange={(key, patch) => dispatch({ type: "update-node", key, patch })}
            organization={organization}
            catalog={catalog}
            storedLibraries={storedLibraries}
          />
        )}
      </SectionCard>
    </div>
  );
}
