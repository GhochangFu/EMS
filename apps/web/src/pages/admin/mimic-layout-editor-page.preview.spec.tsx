import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import {
  MIMIC_SYMBOL_LIBRARIES,
  type AdminAssetGroupListResponse,
  type LocationsListResponse,
  type MimicLayoutDto,
  type MimicSymbolLibrariesResponse,
  type OrganizationsListResponse,
  type VocabulariesResponse,
} from "@bms/shared";

import * as assetGroupsApi from "../../api/admin/asset-groups";
import * as locationsApi from "../../api/admin/locations";
import * as orgApi from "../../api/admin/organizations";
import * as pointKeyApi from "../../api/admin/point-keys";
import * as copilotApi from "../../api/copilot";
import * as api from "../../api/mimic-layouts";
import type { ReplaceMimicLayoutBody } from "../../api/mimic-layouts";
import * as librariesApi from "../../api/mimic-symbol-libraries";
import * as systemStatusApi from "../../api/system-status";
import * as vocabApi from "../../api/vocabularies";
import { previewResponseFixture } from "../../components/mimic-editor/mimic-preview-canvas.spec";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { editorLayoutFromWriteBody, fromPreset, type EditorNode, type EditorPipe } from "../../lib/mimic-editor";
import type { AuthUser } from "../../stores/auth-store";

import { MimicLayoutEditorPage } from "./mimic-layout-editor-page";

/**
 * `F4.308` T9 (ADR 0081 Amendment 2 decisions 4–7, plan C10–C12) — "Preview with site" in the
 * layout editor, rendered: the toggle, the site and group pickers, the preview read, the
 * read-only mode (keys, palette, canvas, inspector), "Save to refresh the preview" and the
 * refetch after a Save. The socket transport is a stub (the `active-alarms-rail.spec.tsx`
 * recipe); every read is stubbed. `mimic-layout-editor-page.preview.test.tsx` is the Vitest entry.
 */

const sockets = vi.hoisted(() => ({ io: vi.fn() }));

vi.mock("socket.io-client", () => ({ io: sockets.io }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const LAYOUT_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "55555555-5555-4555-8555-555555555555";
const EMPTY_LOCATION_ID = "66666666-6666-4666-8666-666666666666";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_2_ID = "77777777-7777-4777-8777-777777777777";

const ADMIN = { id: "u1", email: "a@bms.local", displayName: "A", role: "organization_admin" } as unknown as AuthUser;

const ORGS = { items: [{ id: ORG_ID, code: "ION", name: "Ion Exchange", active: true }] } as unknown as OrganizationsListResponse;

const LOCATIONS = {
  items: [
    { id: LOCATION_ID, organizationId: ORG_ID, code: "PLT", name: "Plant one" },
    { id: EMPTY_LOCATION_ID, organizationId: ORG_ID, code: "EMP", name: "Empty site" },
  ],
} as unknown as LocationsListResponse;

const GROUPS = {
  items: [
    { id: GROUP_ID, code: "WT-1", name: "Water train 1", locationId: LOCATION_ID, organizationId: ORG_ID },
    { id: GROUP_2_ID, code: "WT-2", name: "Water train 2", locationId: LOCATION_ID, organizationId: ORG_ID },
  ],
} as unknown as AdminAssetGroupListResponse;

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

/** The server's order (`MimicLayoutsService.toDto`): nodes by (z, y, x, key), pipes by (fromKey, toKey). */
function serverOrder(nodes: readonly EditorNode[], pipes: readonly EditorPipe[]) {
  const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    nodes: [...nodes].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x || byText(a.key, b.key)),
    pipes: [...pipes].sort((a, b) => byText(a.fromKey, b.fromKey) || byText(a.toKey, b.toKey)),
  };
}

function stubAll() {
  sockets.io.mockReset();
  sockets.io.mockImplementation(() => ({ on: () => undefined, disconnect: () => undefined }));
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(librariesApi, "fetchMimicSymbolLibraries").mockResolvedValue(allEnabledCatalog());
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({ assetRoles: [] } as unknown as VocabulariesResponse);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(ORGS);
  vi.spyOn(pointKeyApi, "fetchAdminPointKeys").mockResolvedValue({ items: [] });
  vi.spyOn(api, "fetchMimicLayouts").mockResolvedValue({ items: [] });
  vi.spyOn(api, "fetchMimicLayout").mockResolvedValue(storedDto(4));
  vi.spyOn(api, "createMimicLayout").mockResolvedValue(storedDto(1));
  // The saved DTO is what was PUT, answered in the server's order (review H1), so the editor holds
  // no unsaved edit after a Save even though a new panel (z 0) was appended last.
  const replace = vi.spyOn(api, "replaceMimicLayout").mockImplementation(async (_id: string, body: ReplaceMimicLayoutBody) => {
    const layout = editorLayoutFromWriteBody(body);
    return {
      ...storedDto(body.version + 1),
      name: layout.name,
      slug: layout.slug,
      ...serverOrder(layout.nodes, layout.pipes),
      symbolLibraries: [...layout.symbolLibraries],
    };
  });
  const locations = vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue(LOCATIONS);
  const groups = vi
    .spyOn(assetGroupsApi, "fetchAdminAssetGroups")
    .mockImplementation(async (locationId?: string) => (locationId === LOCATION_ID ? GROUPS : { items: [] }));
  const preview = vi.spyOn(api, "fetchMimicLayoutPreview").mockResolvedValue(previewResponseFixture());
  return { replace, locations, groups, preview };
}

function renderAt(path: string) {
  const stubs = stubAll();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/mimic-layouts" element={<p>library</p>} />
          <Route path="/admin/mimic-layouts/new" element={<MimicLayoutEditorPage user={ADMIN} />} />
          <Route path="/admin/mimic-layouts/:layoutId" element={<MimicLayoutEditorPage user={ADMIN} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return stubs;
}

const STORED = `/admin/mimic-layouts/${LAYOUT_ID}`;

async function toggle(): Promise<void> {
  await userEvent.click(await screen.findByRole("checkbox", { name: "Preview with site" }));
}

async function pickSite(locationId = LOCATION_ID): Promise<void> {
  const site = await screen.findByRole("combobox", { name: "Site" });
  await waitFor(() => expect(within(site).getAllByRole("option").length).toBeGreaterThan(1));
  await userEvent.selectOptions(site, locationId);
}

async function pickGroup(groupId = GROUP_ID): Promise<void> {
  const group = await screen.findByRole("combobox", { name: "Asset group" });
  await waitFor(() => expect(within(group).getAllByRole("option").length).toBeGreaterThan(1));
  await userEvent.selectOptions(group, groupId);
}

/** Opens the preview on the stored layout, bound to the one group. */
async function openPreview(): Promise<void> {
  await toggle();
  await pickSite();
  await pickGroup();
  await screen.findByTestId("mimic-preview-canvas");
}

function editorHit(key: string): Element | undefined {
  return screen.queryAllByTestId("mimic-editor-hit").find((el) => el.getAttribute("data-node-key") === key);
}

/** V1 — a new (unsaved) layout shows the toggle disabled, and says why. */
export async function aNewLayoutsToggleIsDisabled(): Promise<void> {
  renderAt("/admin/mimic-layouts/new?preset=water_train");
  expect(await screen.findByRole("checkbox", { name: "Preview with site" })).toBeDisabled();
  expect(screen.getByText("Save the layout to preview it")).toBeInTheDocument();
}

/** V2 — the site picker lists the layout organization's active locations (ruling Q2 (a)). */
export async function theSiteListIsTheOrganizationsActiveLocations(): Promise<void> {
  const { locations } = renderAt(STORED);
  await toggle();
  await pickSite();
  expect(locations).toHaveBeenCalledWith("true", ORG_ID);
}

/** V3 — a picked site reads its asset groups by `locationId`. */
export async function aSiteReadsItsGroups(): Promise<void> {
  const { groups } = renderAt(STORED);
  await toggle();
  await pickSite();
  await waitFor(() => expect(groups).toHaveBeenCalledWith(LOCATION_ID));
  expect(await screen.findByRole("option", { name: "WT-1 — Water train 1" })).toBeInTheDocument();
}

/** V4 — a site with no asset group says so. */
export async function aSiteWithNoGroupSaysSo(): Promise<void> {
  renderAt(STORED);
  await toggle();
  await pickSite(EMPTY_LOCATION_ID);
  expect(await screen.findByText("No asset group at this site")).toBeInTheDocument();
}

/** V5 — a picked group reads the preview of the layout bound to it, and draws its assets. */
export async function aGroupReadsThePreview(): Promise<void> {
  const { preview } = renderAt(STORED);
  expect(preview).not.toHaveBeenCalled();
  await openPreview();
  expect(preview).toHaveBeenCalledWith(LAYOUT_ID, GROUP_ID);
  expect(screen.getAllByText("WTR-WTP-01").length).toBeGreaterThan(0);
  expect(screen.queryByTestId("mimic-editor-canvas")).toBeNull();
}

/** V6 — selecting a unit in the preview lists its asset, points and alarms. */
export async function selectingAPreviewUnitListsItsAsset(): Promise<void> {
  renderAt(STORED);
  await openPreview();
  const hit = screen.getAllByTestId("mimic-preview-hit").find((el) => el.getAttribute("data-node-key") === "wtp");
  if (hit === undefined) throw new Error("no wtp hit rect");
  fireEvent.click(hit);
  expect(await screen.findByText("WTR-WTP-01 — Water treatment plant")).toBeInTheDocument();
  expect(screen.getByText("Open alarms: 2")).toBeInTheDocument();
  expect(screen.getByText("CLOSED")).toBeInTheDocument();
}

/** V7 — Delete and the arrows change nothing while the preview is on. */
export async function keysChangeNothingWhileThePreviewIsOn(): Promise<void> {
  renderAt(STORED);
  const wtp = await waitFor(() => {
    const el = editorHit("wtp");
    if (el === undefined) throw new Error("the wtp unit has not drawn yet");
    return el;
  });
  const x = wtp.getAttribute("x");
  fireEvent.pointerDown(wtp);
  fireEvent.pointerUp(wtp);
  await toggle();
  fireEvent.keyDown(window, { key: "ArrowRight" });
  fireEvent.keyDown(window, { key: "Delete" });
  await toggle();
  const after = editorHit("wtp");
  expect(after).toBeDefined();
  expect(after?.getAttribute("x")).toBe(x);
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
}

/** V8 — the palette shows the read-only note and offers nothing to add. */
export async function thePaletteShowsTheReadOnlyNote(): Promise<void> {
  renderAt(STORED);
  await screen.findByRole("button", { name: "Panel" });
  await toggle();
  expect(screen.getByText("Preview is read-only. Turn it off to edit.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Panel" })).toBeNull();
  expect(screen.queryByTestId("mimic-editor-palette")).toBeNull();
}

/** V9 — an edit made before the preview shows "Save to refresh the preview"; none, no note. */
export async function anEditBeforeThePreviewSaysSaveToRefresh(): Promise<void> {
  renderAt(STORED);
  await toggle();
  expect(screen.queryByText("Save to refresh the preview")).toBeNull();
  await toggle();
  await userEvent.click(await screen.findByRole("button", { name: "Panel" }));
  await toggle();
  expect(screen.getByText("Save to refresh the preview")).toBeInTheDocument();
}

/** V10 — Save while the preview is on PUTs, then reads the preview again; the note goes. */
export async function saveWhileOnPutsThenRefetchesThePreview(): Promise<void> {
  const { replace, preview } = renderAt(STORED);
  await userEvent.click(await screen.findByRole("button", { name: "Panel" }));
  await openPreview();
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Save to refresh the preview")).toBeInTheDocument();
  const button = screen.getByRole("button", { name: "Save" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  expect(preview.mock.invocationCallOrder[1]).toBeGreaterThan(replace.mock.invocationCallOrder[0] ?? Infinity);
  await waitFor(() => expect(screen.queryByText("Save to refresh the preview")).toBeNull());
}

/** V11 — turning the preview off restores the editor, the edits made before intact. */
export async function turningItOffRestoresTheEditorWithItsEdits(): Promise<void> {
  renderAt(STORED);
  await userEvent.click(await screen.findByRole("button", { name: "Panel" }));
  const count = screen.getAllByTestId("mimic-editor-hit").length;
  await openPreview();
  await toggle();
  expect(await screen.findByTestId("mimic-editor-canvas")).toBeInTheDocument();
  expect(screen.getAllByTestId("mimic-editor-hit")).toHaveLength(count);
  expect(screen.getByRole("button", { name: "Panel" })).toBeInTheDocument();
  expect(screen.queryByTestId("mimic-preview-canvas")).toBeNull();
}

/** V12 (review M1) — picking a group keeps the focus on the group select; so does a second pick. */
export async function pickingAGroupKeepsTheFocus(): Promise<void> {
  renderAt(STORED);
  await toggle();
  await pickSite();
  const group = await screen.findByRole("combobox", { name: "Asset group" });
  await waitFor(() => expect(within(group).getAllByRole("option").length).toBeGreaterThan(1));
  group.focus();
  await userEvent.selectOptions(group, GROUP_ID);
  await screen.findByTestId("mimic-preview-canvas");
  expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Asset group" }));
  expect(screen.getByRole("combobox", { name: "Asset group" })).toBe(group);
  await userEvent.selectOptions(group, GROUP_2_ID);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Asset group" })).toHaveValue(GROUP_2_ID));
  expect(document.activeElement).toBe(group);
}

/** V13 (review M1) — the Save button and the checkbox survive the preview turning on and off. */
export async function theToolbarStaysMountedAcrossModes(): Promise<void> {
  renderAt(STORED);
  const save = await screen.findByRole("button", { name: "Save" });
  const checkbox = await screen.findByRole("checkbox", { name: "Preview with site" });
  await toggle();
  await pickSite();
  await pickGroup();
  await screen.findByTestId("mimic-preview-canvas");
  await toggle();
  await screen.findByTestId("mimic-editor-canvas");
  expect(screen.getByRole("button", { name: "Save" })).toBe(save);
  expect(screen.getByRole("checkbox", { name: "Preview with site" })).toBe(checkbox);
}

/** V14 (review L1) — no socket before a group is chosen; a new group opens a new one. */
export async function theSocketOpensOnlyOnceAGroupIsChosen(): Promise<void> {
  renderAt(STORED);
  await toggle();
  await pickSite();
  await screen.findByRole("combobox", { name: "Asset group" });
  expect(sockets.io).not.toHaveBeenCalled();
  await pickGroup();
  await screen.findByTestId("mimic-preview-canvas");
  expect(sockets.io).toHaveBeenCalledTimes(1);
  await pickGroup(GROUP_2_ID);
  await waitFor(() => expect(sockets.io).toHaveBeenCalledTimes(2));
}

/** V15 (review L4a) — an answer with no layout widget is an error line, not a lasting load. */
export async function anAnswerWithNoLayoutWidgetSaysSo(): Promise<void> {
  const { preview } = renderAt(STORED);
  preview.mockResolvedValue({ ...previewResponseFixture(), widgets: [] });
  await toggle();
  await pickSite();
  await pickGroup();
  expect(await screen.findByText("The preview could not be drawn.")).toBeInTheDocument();
  expect(screen.queryByText("Loading the preview…")).toBeNull();
}

/** V16 (review L4b) — a failed asset-groups read shows an error line. */
export async function aFailedGroupsReadSaysSo(): Promise<void> {
  const { groups } = renderAt(STORED);
  groups.mockRejectedValue(new Error("groups down"));
  await toggle();
  await pickSite();
  expect(await screen.findByText("The asset groups could not be read.")).toBeInTheDocument();
}

/** V17 (review L4b) — a failed sites read shows an error line. */
export async function aFailedSitesReadSaysSo(): Promise<void> {
  const { locations } = renderAt(STORED);
  locations.mockRejectedValue(new Error("sites down"));
  await toggle();
  expect(await screen.findByText("The sites could not be read.")).toBeInTheDocument();
}

/** V18 (review L4c) — a new layout's disabled toggle is described by the sentence saying why. */
export async function theDisabledToggleIsDescribedByItsReason(): Promise<void> {
  renderAt("/admin/mimic-layouts/new?preset=water_train");
  const checkbox = await screen.findByRole("checkbox", { name: "Preview with site" });
  expect(checkbox).toHaveAccessibleDescription("Save the layout to preview it");
}
