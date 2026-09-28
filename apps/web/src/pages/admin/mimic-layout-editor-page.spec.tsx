import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import type { MimicLayoutDto, OrganizationsListResponse, VocabulariesResponse } from "@bms/shared";

import * as orgApi from "../../api/admin/organizations";
import * as api from "../../api/mimic-layouts";
import * as systemStatusApi from "../../api/system-status";
import * as vocabApi from "../../api/vocabularies";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { ApiError } from "../../lib/api-error";
import { fromPreset, toWriteBody } from "../../lib/mimic-editor";
import type { AuthUser } from "../../stores/auth-store";
import { MimicLayoutEditorPage, STALE_LAYOUT_BANNER, STALE_SERVER_MESSAGE } from "./mimic-layout-editor-page";

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
    nodes: [...layout.nodes],
    pipes: [...layout.pipes],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

type Stubs = {
  fetchOne: ReturnType<typeof vi.spyOn>;
  create: ReturnType<typeof vi.spyOn>;
  replace: ReturnType<typeof vi.spyOn>;
};

function renderAt(path: string, as: AuthUser = user("organization_admin"), orgs = ORGS): Stubs {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({ assetRoles: [] } as unknown as VocabulariesResponse);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(orgs);
  vi.spyOn(api, "fetchMimicLayouts").mockResolvedValue({ items: [] });
  const fetchOne = vi.spyOn(api, "fetchMimicLayout").mockResolvedValue(storedDto(4));
  const create = vi.spyOn(api, "createMimicLayout").mockResolvedValue(storedDto(1));
  const replace = vi.spyOn(api, "replaceMimicLayout").mockResolvedValue(storedDto(5));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
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
  return { fetchOne, create, replace };
}

async function save(): Promise<void> {
  const button = await screen.findByRole("button", { name: "Save" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
}

/** E1 — "Start from Water train" POSTs the preset copy with the organization and no version. */
export async function aNewPresetLayoutPostsWithTheOrganization(): Promise<void> {
  const { create } = renderAt("/admin/mimic-layouts/new?preset=water_train");
  await save();
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create).toHaveBeenCalledWith({ ...toWriteBody(fromPreset("water_train")), organizationId: ORG_ID });
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

/** E10 — a location_admin gets the status line and no read. */
export async function failsClosedForALocationAdmin(): Promise<void> {
  const { fetchOne } = renderAt(`/admin/mimic-layouts/${LAYOUT_ID}`, user("location_admin"));
  expect(await screen.findByRole("status")).toHaveTextContent("Mimic layouts are drawn by");
  expect(fetchOne).not.toHaveBeenCalled();
}
