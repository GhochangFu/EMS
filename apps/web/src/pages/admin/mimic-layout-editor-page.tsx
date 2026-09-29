import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { MimicLayoutDto } from "@bms/shared";
import { MIMIC_LAYOUT_STALE_MESSAGE, mimicPresetSchema } from "@bms/shared/contracts";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { createMimicLayout, fetchMimicLayout, replaceMimicLayout } from "../../api/mimic-layouts";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { MimicEditorCanvas } from "../../components/mimic-editor/canvas";
import { MimicEditorInspector } from "../../components/mimic-editor/inspector";
import { MimicEditorPalette } from "../../components/mimic-editor/palette";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { canManageMimicLayouts } from "../../lib/admin-access";
import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  editorReducer,
  emptyEditorLayout,
  fromPreset,
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
  const [organizationId, setOrganizationId] = useState("");
  // Any preset of the closed enum starts from its copy; an absent or unknown one is blank (plan D9).
  const preset = mimicPresetSchema.safeParse(searchParams.get("preset"));
  const initial = preset.success ? fromPreset(preset.data) : emptyEditorLayout();

  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
  });
  const organizations = orgsQ.data?.items ?? [];

  // One organization (an organization admin's own) is the only choice; select it.
  useEffect(() => {
    const only = organizations.length === 1 ? organizations[0] : undefined;
    if (organizationId === "" && only !== undefined) {
      setOrganizationId(only.id);
    }
  }, [organizations, organizationId]);

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
            className="rounded bg-accent px-3 py-1 text-xs font-semibold text-on-accent"
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
      />
    </>
  );
}

type LayoutEditorProps = {
  initial: EditorLayout;
  saving: boolean;
  saveError: string | null;
  stale: boolean;
  canSave: boolean;
  onSave: (layout: EditorLayout) => void;
  organization?: Parameters<typeof MimicEditorInspector>[0]["organization"];
};

function LayoutEditor({ initial, saving, saveError, stale, canSave, onSave, organization }: LayoutEditorProps) {
  const [state, dispatch] = useReducer(editorReducer, initial, initialEditorState);
  const [pipeMode, setPipeMode] = useState(false);

  // Keyboard (ADR 0081 decision 7). `keyboardAction` yields to inputs, selects and textareas,
  // so typing in the inspector never moves a node.
  useEffect(() => {
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
  }, [state]);

  const selected = state.selected === null ? null : (state.layout.nodes.find((n) => n.key === state.selected) ?? null);

  return (
    <div className="grid gap-3 lg:grid-cols-[14rem_minmax(0,1fr)_16rem]">
      <SectionCard title="Palette" bodyClassName="p-3">
        <MimicEditorPalette
          onAddUnit={(symbol) => dispatch({ type: "add-unit", symbol })}
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
        />
      </SectionCard>
      <SectionCard title={state.layout.name} bodyClassName="p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link to="/admin/mimic-layouts" className="text-xs font-semibold text-accent">
            Back to the library
          </Link>
          <button
            type="button"
            disabled={saving || stale || !canSave}
            aria-busy={saving}
            onClick={() => onSave(state.layout)}
            className="rounded bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {saveError !== null ? (
          <p role="alert" className="text-xs text-critical-ink">
            {saveError}
          </p>
        ) : null}
        <MimicEditorCanvas state={state} dispatch={dispatch} pipeMode={pipeMode} />
      </SectionCard>
      <SectionCard title="Inspector" bodyClassName="p-3">
        <MimicEditorInspector
          layout={state.layout}
          selected={selected}
          onLayoutChange={(patch) => dispatch({ type: "update-layout", patch })}
          onNodeChange={(key, patch) => dispatch({ type: "update-node", key, patch })}
          organization={organization}
        />
      </SectionCard>
    </div>
  );
}
