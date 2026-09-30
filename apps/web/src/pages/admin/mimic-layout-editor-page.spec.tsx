import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import {
  MIMIC_SYMBOL_LIBRARIES,
  type MimicLayoutDto,
  type MimicSymbolLibrariesResponse,
  type OrganizationsListResponse,
  type VocabulariesResponse,
} from "@bms/shared";

import * as orgApi from "../../api/admin/organizations";
import * as api from "../../api/mimic-layouts";
import * as librariesApi from "../../api/mimic-symbol-libraries";
import * as canvasModule from "../../components/mimic-editor/canvas";
import { orgCatalogFixture, orgSymbolFixture } from "../../lib/mimic-symbols.spec";
import * as systemStatusApi from "../../api/system-status";
import * as vocabApi from "../../api/vocabularies";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { ApiError } from "../../lib/api-error";
import { emptyEditorLayout, fromPreset, toWriteBody } from "../../lib/mimic-editor";
import type { AuthUser } from "../../stores/auth-store";
import { MIMIC_LAYOUT_STALE_MESSAGE as STALE_SERVER_MESSAGE } from "@bms/shared/contracts";

import { MimicLayoutEditorPage, STALE_LAYOUT_BANNER } from "./mimic-layout-editor-page";

/**
 * `F3.32c` U6c — the mimic layout editor page, rendered: POST on a new layout with the
 * organization, PUT on a stored one with its version, the 409 Reload banner, the keyboard, and
 * the fail-closed status line. Every read and write is stubbed (an unstubbed read reaches a local
 * API on `:4000`). `mimic-layout-editor-page.test.tsx` is the Vitest entry.
 */

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const LAYOUT_ID = "11111111-1111-4111-8111-111111111111";

function user(role: AuthUser["role"]): AuthUser {
  return { id: "u1", email: "a@bms.local", displayName: "A", role } as unknown as AuthUser;
}

const ORGS = {
  items: [{ id: ORG_ID, code: "ION", name: "Ion Exchange", active: true }],
} as unknown as OrganizationsListResponse;

const TWO_ORGS = {
  items: [
    { id: ORG_ID, code: "ION", name: "Ion Exchange", active: true },
    { id: "33333333-3333-4333-8333-333333333333", code: "PHE", name: "PHE", active: true },
  ],
} as unknown as OrganizationsListResponse;

function storedDto(version: number): MimicLayoutDto {
  const layout = fromPreset("water_train");
  return {
    id: LAYOUT_ID,
    organizationId: ORG_ID,
    name: "Stored plant",
    slug: "stored-plant",
    canvasW: layout.canvasW,
    canvasH: layout.canvasH,
    version,
    symbolLibraries: ["core"],
    nodes: [...layout.nodes],
    pipes: [...layout.pipes],
    orgSymbols: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

type Stubs = {
  fetchOne: ReturnType<typeof vi.spyOn>;
  create: ReturnType<typeof vi.spyOn>;
  replace: ReturnType<typeof vi.spyOn>;
  catalog: ReturnType<typeof vi.spyOn>;
};

/** Every static library enabled for the organization, and no organization library. */
function allEnabledCatalog(): MimicSymbolLibrariesResponse {
  return {
    global: MIMIC_SYMBOL_LIBRARIES.map((library) => ({
      code: library.code,
      label: library.label,
      style: library.style,
      licence: library.licence,
      active: true,
      enabled: true,
      inactiveSymbolKeys: [],
    })),
    organization: [],
  };
}

function stubAll(orgs: OrganizationsListResponse): Stubs {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  const catalog = vi.spyOn(librariesApi, "fetchMimicSymbolLibraries").mockResolvedValue(allEnabledCatalog());
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({ assetRoles: [] } as unknown as VocabulariesResponse);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(orgs);
  vi.spyOn(api, "fetchMimicLayouts").mockResolvedValue({ items: [] });
  const fetchOne = vi.spyOn(api, "fetchMimicLayout").mockResolvedValue(storedDto(4));
  const create = vi.spyOn(api, "createMimicLayout").mockResolvedValue(storedDto(1));
  const replace = vi.spyOn(api, "replaceMimicLayout").mockResolvedValue(storedDto(5));
  return { fetchOne, create, replace, catalog };
}

function mount(client: QueryClient, path: string, as: AuthUser): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/mimic-layouts" element={<p>library</p>} />
          <Route path="/admin/mimic-layouts/new" element={<MimicLayoutEditorPage user={as} />} />
          <Route path="/admin/mimic-layouts/:layoutId" element={<MimicLayoutEditorPage user={as} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderAt(path: string, as: AuthUser = user("organization_admin"), orgs = ORGS): Stubs {
  const stubs = stubAll(orgs);
  mount(newClient(), path, as);
  return stubs;
}

async function save(): Promise<void> {
  const button = await screen.findByRole("button", { name: "Save" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
}

/** E1 — Start from Water train POSTs the preset copy with the organization and no version. */
export async function aNewPresetLayoutPostsWithTheOrganization(): Promise<void> {
  const { create } = renderAt("/admin/mimic-layouts/new?preset=water_train");
  await save();
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create).toHaveBeenCalledWith({ ...toWriteBody(fromPreset("water_train")), organizationId: ORG_ID });
}

/** E1b — `?preset=compressed_air` POSTs that preset's copy (ADR 0082 decision 5, plan D9). */
export async function aDomainPresetLayoutPostsItsCopy(): Promise<void> {
  const { create } = renderAt("/admin/mimic-layouts/new?preset=compressed_air");
  await save();
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create).toHaveBeenCalledWith({ ...toWriteBody(fromPreset("compressed_air")), organizationId: ORG_ID });
}

/** E1c — an unknown `?preset=` is the blank layout, never a crash. */
export async function anUnknownPresetPostsTheBlankLayout(): Promise<void> {
  const { create } = renderAt("/admin/mimic-layouts/new?preset=bogus");
  await save();
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create).toHaveBeenCalledWith({ ...toWriteBody(emptyEditorLayout()), organizationId: ORG_ID });
}

/** E1d — the canvas card is titled by the preset's label. */
export async function aDomainPresetLayoutIsTitledByItsLabel(): Promise<void> {
  renderAt("/admin/mimic-layouts/new?preset=compressed_air");
  expect(await screen.findByRole("heading", { name: "Compressed air" })).toBeInTheDocument();
}

/** E2 — a new layout never PUTs. */
export async function aNewLayoutNeverPuts(): Promise<void> {
  const { create, replace } = renderAt("/admin/mimic-layouts/new");
  await save();
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(replace).not.toHaveBeenCalled();
}

/** E3 — with two organizations and none chosen, Save stays disabled. */
export async function saveWaitsForAnOrganization(): Promise<void> {
  renderAt("/admin/mimic-layouts/new", user("admin"), TWO_ORGS);
  await screen.findByRole("option", { name: "PHE — PHE" });
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
}

/** E4a — a stored layout PUTs to its own id. */
export async function aStoredLayoutPutsToItsId(): Promise<void> {
  const { replace } = renderAt(`/admin/mimic-layouts/${LAYOUT_ID}`);
  await save();
  await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  expect(replace.mock.calls[0]?.[0]).toBe(LAYOUT_ID);
}

/** E4b — the PUT carries the version the layout was loaded at. */
export async function aStoredLayoutPutsWithItsVersion(): Promise<void> {
  const { replace } = renderAt(`/admin/mimic-layouts/${LAYOUT_ID}`);
  await save();
  await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  expect((replace.mock.calls[0]?.[1] as { version: number }).version).toBe(4);
}

/** E5 — the next save after a successful one carries the version the server answered. */
export async function theNextSaveCarriesTheNewVersion(): Promise<void> {
  const { replace } = renderAt(`/admin/mimic-layouts/${LAYOUT_ID}`);
  await save();
  await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  await save();
  await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
  expect((replace.mock.calls[1]?.[1] as { version: number }).version).toBe(5);
}

/** E6 — a 409 on save shows the Reload banner. */
export async function aStaleSaveShowsTheReloadBanner(): Promise<void> {
  const { replace } = renderAt(`/admin/mimic-layouts/${LAYOUT_ID}`);
  replace.mockRejectedValue(new ApiError(JSON.stringify({ message: STALE_SERVER_MESSAGE, statusCode: 409 }), 409));
  await save();
  expect(await screen.findByText(STALE_LAYOUT_BANNER)).toBeInTheDocument();
}

/** E7 — Reload reads the layout again and clears the banner. */
export async function reloadReadsTheLayoutAgain(): Promise<void> {
  const { replace, fetchOne } = renderAt(`/admin/mimic-layouts/${LAYOUT_ID}`);
  replace.mockRejectedValue(new ApiError(JSON.stringify({ message: STALE_SERVER_MESSAGE, statusCode: 409 }), 409));
  await save();
  await userEvent.click(await screen.findByRole("button", { name: "Reload" }));
  await waitFor(() => expect(screen.queryByText(STALE_LAYOUT_BANNER)).toBeNull());
  expect(fetchOne).toHaveBeenCalledTimes(2);
}

/** E8 — any other refusal shows the server's sentence. */
export async function anotherRefusalShowsTheServersSentence(): Promise<void> {
  const { replace } = renderAt(`/admin/mimic-layouts/${LAYOUT_ID}`);
  replace.mockRejectedValue(new ApiError(JSON.stringify({ message: "Unknown asset role code", statusCode: 400 }), 400));
  await save();
  expect((await screen.findByRole("alert")).textContent).toBe("Unknown asset role code");
}

/** E9 — Ctrl+Z on the page undoes the last palette add. */
export async function ctrlZUndoesTheLastAdd(): Promise<void> {
  renderAt("/admin/mimic-layouts/new");
  await userEvent.click(await screen.findByRole("button", { name: "Add Tank unit" }));
  expect(screen.getAllByTestId("mimic-editor-hit")).toHaveLength(1);
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(screen.queryAllByTestId("mimic-editor-hit")).toHaveLength(0));
}

const SLUG_TAKEN = 'A layout with slug "stored-plant" already exists in this organization';

function slugTaken(replace: Stubs["replace"]): void {
  replace.mockRejectedValue(new ApiError(JSON.stringify({ message: SLUG_TAKEN, statusCode: 409 }), 409));
}

/** E11 — a slug 409 on PUT is an ordinary error: its sentence is shown. */
export async function aSlugConflictShowsItsSentence(): Promise<void> {
  const { replace } = renderAt(`/admin/mimic-layouts/${LAYOUT_ID}`);
  slugTaken(replace);
  await save();
  expect((await screen.findByRole("alert")).textContent).toBe(SLUG_TAKEN);
}

/** E12 — a slug 409 shows no Reload banner. */
export async function aSlugConflictShowsNoReloadBanner(): Promise<void> {
  const { replace } = renderAt(`/admin/mimic-layouts/${LAYOUT_ID}`);
  slugTaken(replace);
  await save();
  await screen.findByText(SLUG_TAKEN);
  expect(screen.queryByText(STALE_LAYOUT_BANNER)).toBeNull();
}

/** E13 — after a slug 409, Save stays enabled: the author edits the slug and saves again. */
export async function aSlugConflictLeavesSaveEnabled(): Promise<void> {
  const { replace } = renderAt(`/admin/mimic-layouts/${LAYOUT_ID}`);
  slugTaken(replace);
  await save();
  await screen.findByText(SLUG_TAKEN);
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
}

/** The layout a save answers with: three nodes (the stored one has twelve), so the page can tell
 * the saved drawing from the loaded one. */
function savedDto(version: number): MimicLayoutDto {
  const stored = storedDto(version);
  return { ...stored, name: "Saved plant", nodes: stored.nodes.slice(0, 3), pipes: [] };
}

/**
 * A stored layout saved once, the page left and opened again on the SAME QueryClient — what the
 * browser does when the author goes back to the library and reopens the layout. After the save
 * the server answers `fetchMimicLayout` with the saved layout, as the real API would.
 */
async function saveLeaveAndReopen(): Promise<Stubs> {
  const stubs = stubAll(ORGS);
  stubs.replace.mockResolvedValue(savedDto(5));
  const client = newClient();
  const as = user("organization_admin");
  const first = mount(client, `/admin/mimic-layouts/${LAYOUT_ID}`, as);
  await save();
  await waitFor(() => expect(stubs.replace).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  stubs.fetchOne.mockResolvedValue(savedDto(5));
  first.unmount();
  mount(client, `/admin/mimic-layouts/${LAYOUT_ID}`, as);
  return stubs;
}

/** E14 — reopened after a save, the editor draws the saved layout, not the one first loaded. */
export async function aReopenedLayoutShowsTheSavedDrawing(): Promise<void> {
  await saveLeaveAndReopen();
  await waitFor(() => expect(screen.getAllByTestId("mimic-editor-hit")).toHaveLength(3));
}

/** E15 — reopened after a save, the next PUT carries the saved version (no false stale 409). */
export async function aReopenedLayoutPutsWithTheSavedVersion(): Promise<void> {
  const { replace } = await saveLeaveAndReopen();
  await save();
  await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
  expect((replace.mock.calls[1]?.[1] as { version: number }).version).toBe(5);
}

/** E16 — a new layout's first save opens the saved layout at once: its detail is cached before
 * the page moves to its route. `fetchMimicLayout` never answers here, so only the cache can
 * draw it. */
export async function aFirstSaveOpensTheSavedLayoutFromTheCache(): Promise<void> {
  const { create, fetchOne } = stubAll(ORGS);
  create.mockResolvedValue(savedDto(1));
  fetchOne.mockReturnValue(new Promise<MimicLayoutDto>(() => {}));
  mount(newClient(), "/admin/mimic-layouts/new", user("organization_admin"));
  await save();
  await waitFor(() => expect(screen.getAllByTestId("mimic-editor-hit")).toHaveLength(3));
}

/** E17 — a new layout's POST carries `symbolLibraries: ["core"]` (ADR 0084 decision 8). */
export async function aNewLayoutPostsTheCoreLibrary(): Promise<void> {
  const { create } = renderAt("/admin/mimic-layouts/new");
  await save();
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect((create.mock.calls[0]?.[0] as { symbolLibraries: unknown }).symbolLibraries).toEqual(["core"]);
}

/** E18 — the palette offers the stored layout's libraries: one tab each. */
export async function thePaletteOffersTheLayoutsLibraries(): Promise<void> {
  const stubs = stubAll(ORGS);
  stubs.fetchOne.mockResolvedValue({ ...storedDto(4), symbolLibraries: ["core", "mdi"] });
  mount(newClient(), `/admin/mimic-layouts/${LAYOUT_ID}`, user("organization_admin"));
  const tablist = await screen.findByRole("tablist");
  expect(within(tablist).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Core", "Material Design Icons"]);
}

/** E19 — checking a library in the inspector adds its palette tab. */
export async function checkingALibraryAddsItsTab(): Promise<void> {
  renderAt("/admin/mimic-layouts/new");
  // Positive control for the absent tablist: the core palette is drawn.
  await screen.findByRole("button", { name: "Add Tank unit" });
  expect(screen.queryByRole("tablist")).toBeNull();
  await userEvent.click(screen.getByRole("checkbox", { name: "Library Tabler Icons" }));
  expect(within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Core", "Tabler Icons"]);
}

// ---- organization libraries (F3.32f slice 3, plan D9, ruling R13) ----------------------------

/** The canvas's `orgSymbols` keys, from its last render. */
function canvasOrgSymbolKeys(spy: ReturnType<typeof vi.spyOn>): string[] {
  const last = spy.mock.calls.at(-1)?.[0] as { orgSymbols?: readonly { key: string }[] } | undefined;
  return (last?.orgSymbols ?? []).map((s) => s.key).sort();
}

/** E20 — a stored layout reads the catalog of its own organization. */
export async function aStoredLayoutReadsItsOrganizationsCatalog(): Promise<void> {
  const { catalog } = renderAt(`/admin/mimic-layouts/${LAYOUT_ID}`);
  await waitFor(() => expect(catalog).toHaveBeenCalledWith(ORG_ID));
}

/** E21 — a new layout reads the catalog of the chosen organization, never an unscoped one. */
export async function aNewLayoutReadsTheChosenOrganizationsCatalog(): Promise<void> {
  const { catalog } = renderAt("/admin/mimic-layouts/new");
  await waitFor(() => expect(catalog).toHaveBeenCalledWith(ORG_ID));
  expect(catalog).not.toHaveBeenCalledWith(undefined);
}

/** E22 — with two organizations and none chosen, no catalog read starts. */
export async function aNewLayoutWithNoOrganizationReadsNoCatalog(): Promise<void> {
  const { catalog } = renderAt("/admin/mimic-layouts/new", user("admin"), TWO_ORGS);
  // Positive control: the organization select rendered with both options.
  expect(await screen.findByRole("option", { name: "PHE — PHE" })).toBeInTheDocument();
  expect(catalog).not.toHaveBeenCalled();
}

/** E23 — the catalog's org symbols reach the canvas. */
export async function theCatalogsOrgSymbolsReachTheCanvas(): Promise<void> {
  const spy = vi.spyOn(canvasModule, "MimicEditorCanvas");
  const stubs = stubAll(ORGS);
  stubs.catalog.mockResolvedValue(orgCatalogFixture());
  mount(newClient(), `/admin/mimic-layouts/${LAYOUT_ID}`, user("organization_admin"));
  await waitFor(() => expect(canvasOrgSymbolKeys(spy)).toContain("org.plant:inlet"));
}

/** E24 — the stored layout's embedded org symbols reach the canvas beside the catalog's. */
export async function theLayoutsEmbeddedOrgSymbolsReachTheCanvas(): Promise<void> {
  const spy = vi.spyOn(canvasModule, "MimicEditorCanvas");
  const stubs = stubAll(ORGS);
  stubs.catalog.mockResolvedValue(orgCatalogFixture());
  stubs.fetchOne.mockResolvedValue({ ...storedDto(4), orgSymbols: [orgSymbolFixture("org.gone:valve", "Gone valve")] });
  mount(newClient(), `/admin/mimic-layouts/${LAYOUT_ID}`, user("organization_admin"));
  await waitFor(() => expect(canvasOrgSymbolKeys(spy)).toContain("org.plant:inlet"));
  expect(canvasOrgSymbolKeys(spy)).toContain("org.gone:valve");
}

/** E25 — the palette offers an org library the layout chose, once the catalog is read. */
export async function thePaletteOffersAChosenOrgLibrary(): Promise<void> {
  const stubs = stubAll(ORGS);
  stubs.catalog.mockResolvedValue(orgCatalogFixture());
  stubs.fetchOne.mockResolvedValue({ ...storedDto(4), symbolLibraries: ["core", "org.plant"] });
  mount(newClient(), `/admin/mimic-layouts/${LAYOUT_ID}`, user("organization_admin"));
  expect(await screen.findByRole("tab", { name: "Plant" })).toBeInTheDocument();
}

/** E10 — a location_admin gets the status line and no read. */
export async function failsClosedForALocationAdmin(): Promise<void> {
  const { fetchOne } = renderAt(`/admin/mimic-layouts/${LAYOUT_ID}`, user("location_admin"));
  expect(await screen.findByRole("status")).toHaveTextContent("Mimic layouts are drawn by");
  expect(fetchOne).not.toHaveBeenCalled();
}
