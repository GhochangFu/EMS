import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { OrganizationsListResponse } from "@bms/shared";

import * as orgApi from "../../api/admin/organizations";
import * as api from "../../api/mimic-symbol-libraries";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import * as glyphs from "../../components/widgets/mimic-glyphs";
import { ApiError } from "../../lib/api-error";
import { orgCatalogFixture, orgSymbolFixture } from "../../lib/mimic-symbols.spec";
import type { AuthUser } from "../../stores/auth-store";
import { MimicSymbolLibrariesPage } from "./mimic-symbol-libraries-page";
import * as copilotApi from "../../api/copilot";

/**
 * `F3.32f` slice 3 (ADR 0086 decisions 4, 6, 7; plan D10) — the Symbol Libraries admin page,
 * rendered. Every read and write of `api/mimic-symbol-libraries` is stubbed with `vi.spyOn`, and
 * so are the organization list and `fetchSystemStatus` (an unstubbed read reaches a local API on
 * `:4000`). The upload claim alone stubs the global `fetch` and lets the real
 * `uploadMimicOrgSymbol` run, so a JSON body built inside the API module reddens it.
 * `mimic-symbol-libraries-page.test.tsx` is the Vitest entry.
 *
 * `F3.87` PR 6b (plan D6): every write opens its catalog entry's wizard; {@link submitWizard}
 * steps through it (Next until Submit) before the write is asserted.
 */

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const PLANT_ID = "00000000-0000-4000-8000-0000000000a1";
const LEGACY_ID = "00000000-0000-4000-8000-0000000000a2";

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

function plant() {
  const library = orgCatalogFixture().organization[0];
  if (library === undefined) throw new Error("no plant library");
  return library;
}

function stubAll(orgs: OrganizationsListResponse = ORGS) {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(orgs);
  return {
    catalog: vi.spyOn(api, "fetchMimicSymbolLibraries").mockResolvedValue(orgCatalogFixture()),
    setting: vi
      .spyOn(api, "putMimicLibrarySetting")
      .mockResolvedValue({ organizationId: ORG_ID, libraryCode: "lucide", enabled: false, updatedAt: new Date(0).toISOString() }),
    create: vi.spyOn(api, "createMimicOrgSymbolLibrary").mockResolvedValue(plant()),
    updateLibrary: vi.spyOn(api, "updateMimicOrgSymbolLibrary").mockResolvedValue(plant()),
    upload: vi.spyOn(api, "uploadMimicOrgSymbol").mockResolvedValue(orgSymbolFixture("org.plant:inlet", "Inlet screen")),
    updateSymbol: vi.spyOn(api, "updateMimicOrgSymbol").mockResolvedValue(orgSymbolFixture("org.plant:inlet", "Inlet screen")),
  };
}

function mount(as: AuthUser = user("organization_admin")): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/mimic-symbol-libraries"]}>
        <MimicSymbolLibrariesPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function globalBoxes(): Promise<HTMLElement[]> {
  return screen.findAllByRole("checkbox", { name: /^Enable .* for this organization$/ });
}

async function plantCard(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: "Plant" });
}

/** `F3.87` PR 6b: the wizard dialog named `name`, stepped with Next until its Review step, then Submit. */
async function submitWizard(name: string | RegExp): Promise<HTMLElement> {
  const dialog = await screen.findByRole("dialog", { name });
  while (within(dialog).queryByRole("button", { name: "Submit" }) === null) {
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  }
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  return dialog;
}

// ---- global libraries ------------------------------------------------------------------------

/** L1 — one `Enable …` box per global library, in the catalog's order. */
export async function theGlobalTableHasOneBoxPerLibrary(): Promise<void> {
  stubAll();
  mount();
  const names = (await globalBoxes()).map((b) => b.getAttribute("aria-label"));
  expect(names).toEqual([
    "Enable Core for this organization",
    "Enable Tabler Icons for this organization",
    "Enable Lucide for this organization",
    "Enable Material Design Icons for this organization",
  ]);
}

/** L2 — the core box is disabled. */
export async function theCoreBoxIsDisabled(): Promise<void> {
  stubAll();
  mount();
  expect(await screen.findByRole("checkbox", { name: "Enable Core for this organization" })).toBeDisabled();
}

/** L3 — the core box says why. */
export async function theCoreBoxSaysWhy(): Promise<void> {
  stubAll();
  mount();
  const box = await screen.findByRole("checkbox", { name: "Enable Core for this organization" });
  expect(box).toHaveAttribute("title", "Core cannot be disabled");
}

/** L4 — another library's box is enabled (the control for L2). */
export async function anotherLibrarysBoxIsEnabled(): Promise<void> {
  stubAll();
  mount();
  expect(await screen.findByRole("checkbox", { name: "Enable Lucide for this organization" })).toBeEnabled();
}

/** L5 — a box shows the organization's switch: Tabler off, Lucide on. */
export async function aBoxShowsTheSwitch(): Promise<void> {
  stubAll();
  mount();
  expect(await screen.findByRole("checkbox", { name: "Enable Tabler Icons for this organization" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Enable Lucide for this organization" })).toBeChecked();
}

/** L6 — unchecking Lucide opens the setting wizard, whose Submit turns it off for the organization. */
export async function uncheckingLucidePutsTheSetting(): Promise<void> {
  const { setting } = stubAll();
  mount();
  await userEvent.click(await screen.findByRole("checkbox", { name: "Enable Lucide for this organization" }));
  expect(setting).not.toHaveBeenCalled();
  await submitWizard("Turn Lucide off for this organization");
  await waitFor(() => expect(setting).toHaveBeenCalledWith("lucide", { organizationId: ORG_ID, enabled: false }));
}

/** L7 — the wizard's Submit is busy while the switch is saved. */
export async function theBoxIsBusyWhilePending(): Promise<void> {
  const { setting } = stubAll();
  setting.mockReturnValue(new Promise(() => undefined));
  mount();
  await userEvent.click(await screen.findByRole("checkbox", { name: "Enable Lucide for this organization" }));
  const dialog = await submitWizard("Turn Lucide off for this organization");
  const busy = await within(dialog).findByRole("button", { name: "Submitting…" });
  expect(busy).toBeDisabled();
}

/** L8 — a saved switch re-reads the catalog and closes the wizard. */
export async function aSavedSwitchRereadsTheCatalog(): Promise<void> {
  const { catalog } = stubAll();
  mount();
  await userEvent.click(await screen.findByRole("checkbox", { name: "Enable Lucide for this organization" }));
  await submitWizard("Turn Lucide off for this organization");
  await waitFor(() => expect(catalog).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("dialog", { name: "Turn Lucide off for this organization" })).toBeNull();
}

// ---- organization libraries ------------------------------------------------------------------

/** L9 — the create wizard posts the library's body. */
export async function theCreateFormPostsTheBody(): Promise<void> {
  const { create } = stubAll();
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "New library" }));
  const form = await screen.findByRole("dialog", { name: "New organization library" });
  await userEvent.type(within(form).getByRole("textbox", { name: "Code" }), "valves");
  await userEvent.type(within(form).getByRole("textbox", { name: "Label" }), "Valves");
  await userEvent.selectOptions(within(form).getByRole("combobox", { name: "Style" }), "fill");
  await userEvent.click(within(form).getByRole("button", { name: "Next" }));
  await userEvent.type(within(form).getByRole("textbox", { name: "Licence" }), "CC0");
  await userEvent.type(within(form).getByRole("textbox", { name: "Attribution" }), "Our own");
  await userEvent.type(within(form).getByRole("textbox", { name: "Source URL" }), "https://example.com/valves");
  await submitWizard("New organization library");
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      code: "valves",
      label: "Valves",
      style: "fill",
      licence: "CC0",
      attribution: "Our own",
      sourceUrl: "https://example.com/valves",
    }),
  );
}

/** L10 — an active library shows Active and a Retire button. */
export async function anActiveLibraryShowsActive(): Promise<void> {
  stubAll();
  mount();
  const card = await plantCard();
  expect(within(card).getByText("Active", { selector: "span" })).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "Retire" })).toBeInTheDocument();
}

/** L11 — Retire sends `active: false`. */
export async function retireSendsActiveFalse(): Promise<void> {
  const { updateLibrary } = stubAll();
  mount();
  await userEvent.click(within(await plantCard()).getByRole("button", { name: "Retire" }));
  expect(updateLibrary).not.toHaveBeenCalled();
  await submitWizard("Retire Plant");
  await waitFor(() => expect(updateLibrary).toHaveBeenCalledWith(PLANT_ID, { active: false }));
}

/** L12 — a retired library shows Retired, and Reactivate sends `active: true`. */
export async function reactivateSendsActiveTrue(): Promise<void> {
  const { updateLibrary } = stubAll();
  mount();
  const card = await screen.findByRole("region", { name: "Legacy" });
  expect(within(card).getByText("Retired", { selector: "span" })).toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "Reactivate" }));
  await submitWizard("Reactivate Legacy");
  await waitFor(() => expect(updateLibrary).toHaveBeenCalledWith(LEGACY_ID, { active: true }));
}

const UPLOAD_DIALOG = "Upload a symbol to Plant";

/** `F3.87` PR 6b: the Plant card's "Upload a symbol" action opens the upload wizard. */
async function openUpload(): Promise<HTMLElement> {
  await userEvent.click(within(await plantCard()).getByRole("button", { name: "Upload a symbol" }));
  return screen.findByRole("dialog", { name: UPLOAD_DIALOG });
}

/** L13 — the upload sends a `FormData`, `file` first, with no `Content-Type` of its own. */
export async function theUploadSendsFormData(): Promise<void> {
  const stubs = stubAll();
  stubs.upload.mockRestore();
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(orgSymbolFixture("org.plant:intake", "Intake")), { status: 201 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  mount();
  const card = await openUpload();
  await userEvent.upload(
    within(card).getByLabelText("Symbol file"),
    new File(["<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='8'/></svg>"], "intake.svg", { type: "image/svg+xml" }),
  );
  await userEvent.type(within(card).getByRole("textbox", { name: "Symbol name" }), "intake");
  await userEvent.type(within(card).getByRole("textbox", { name: "Symbol label" }), "Intake");
  await userEvent.selectOptions(within(card).getByRole("combobox", { name: "Symbol group" }), "water");
  await submitWizard(UPLOAD_DIALOG);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toMatch(new RegExp(`/api/v1/mimic-symbol-libraries/${PLANT_ID}/symbols$`));
  expect(init.body).toBeInstanceOf(FormData);
  const body = init.body as FormData;
  expect([...body.keys()]).toEqual(["file", "name", "label", "group"]);
  expect(new Headers(init.headers).get("content-type")).toBeNull();
}

/** L14 — the API's 400 is shown in an alert. */
export async function aRefusedUploadShowsTheMessage(): Promise<void> {
  const { upload } = stubAll();
  upload.mockRejectedValue(
    new ApiError(JSON.stringify({ message: "Element <script> is not allowed in a symbol", statusCode: 400 }), 400),
  );
  mount();
  const card = await openUpload();
  await userEvent.upload(within(card).getByLabelText("Symbol file"), new File(["<svg/>"], "bad.svg", { type: "image/svg+xml" }));
  await submitWizard(UPLOAD_DIALOG);
  expect(await within(card).findByRole("alert")).toHaveTextContent("Element <script> is not allowed in a symbol");
}

/** L15 — the wizard's Submit is busy and disabled while the file is sent. */
export async function theUploadButtonIsBusyWhilePending(): Promise<void> {
  const { upload } = stubAll();
  upload.mockReturnValue(new Promise(() => undefined));
  mount();
  const card = await openUpload();
  await userEvent.upload(within(card).getByLabelText("Symbol file"), new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }));
  await submitWizard(UPLOAD_DIALOG);
  const button = await within(card).findByRole("button", { name: "Submitting…" });
  expect(button).toBeDisabled();
}

/** L16 — the file input takes SVG only. */
export async function theFileInputTakesSvgOnly(): Promise<void> {
  stubAll();
  mount();
  expect(within(await openUpload()).getByLabelText("Symbol file")).toHaveAttribute("accept", "image/svg+xml");
}

// ---- the symbols table -----------------------------------------------------------------------

/** L17 — one preview per symbol, each drawn from its stored symbol. */
export async function eachSymbolHasAPreview(): Promise<void> {
  stubAll();
  const spy = vi.spyOn(glyphs, "MimicGlyph");
  mount();
  const card = await plantCard();
  expect(within(card).getAllByTestId("mimic-org-symbol-preview")).toHaveLength(2);
  const drawn = new Set(spy.mock.calls.map(([props]) => props.orgSymbol?.key));
  expect(drawn.has("org.plant:inlet") && drawn.has("org.plant:old-pump")).toBe(true);
}

/** L18 — a symbol row shows its key and label. */
export async function aSymbolRowShowsItsKeyAndLabel(): Promise<void> {
  stubAll();
  mount();
  const card = await plantCard();
  expect(within(card).getByText("org.plant:inlet")).toBeInTheDocument();
  expect(within(card).getByText("Inlet screen")).toBeInTheDocument();
}

/** L19 — unchecking Active retires the symbol. */
export async function uncheckingActiveRetiresTheSymbol(): Promise<void> {
  const { updateSymbol } = stubAll();
  mount();
  const card = await plantCard();
  await userEvent.click(within(card).getByRole("checkbox", { name: "Active Inlet screen" }));
  expect(updateSymbol).not.toHaveBeenCalled();
  await submitWizard("Edit Inlet screen");
  const inlet = orgSymbolFixture("org.plant:inlet", "Inlet screen");
  await waitFor(() => expect(updateSymbol).toHaveBeenCalledWith(PLANT_ID, inlet.id, { active: false }));
}

/** L20 — a retired symbol's Active box is unchecked. */
export async function aRetiredSymbolIsUnchecked(): Promise<void> {
  stubAll();
  mount();
  expect(within(await plantCard()).getByRole("checkbox", { name: "Active Old pump" })).not.toBeChecked();
}

/** L21 — changing a symbol's group sends it. */
export async function changingTheGroupSendsIt(): Promise<void> {
  const { updateSymbol } = stubAll();
  mount();
  const card = await plantCard();
  await userEvent.selectOptions(within(card).getByRole("combobox", { name: "Group of Inlet screen" }), "hvac");
  await submitWizard("Edit Inlet screen");
  const inlet = orgSymbolFixture("org.plant:inlet", "Inlet screen");
  await waitFor(() => expect(updateSymbol).toHaveBeenCalledWith(PLANT_ID, inlet.id, { group: "hvac" }));
}

// ---- organizations and roles -----------------------------------------------------------------

/** L22 — the catalog is read for the organization. */
export async function theCatalogIsReadForTheOrganization(): Promise<void> {
  const { catalog } = stubAll();
  mount();
  await waitFor(() => expect(catalog).toHaveBeenCalledWith(ORG_ID));
}

/** L23 — an organization administrator sees no organization select. */
export async function anOrganizationAdminSeesNoOrganizationSelect(): Promise<void> {
  stubAll();
  mount(user("organization_admin"));
  // Positive control: the page rendered the catalog.
  await globalBoxes();
  expect(screen.queryByRole("combobox", { name: "Organization" })).toBeNull();
}

/** L24 — a global administrator with two organizations chooses one before any read. */
export async function aGlobalAdminChoosesTheOrganization(): Promise<void> {
  const { catalog } = stubAll(TWO_ORGS);
  mount(user("admin"));
  const select = await screen.findByRole("combobox", { name: "Organization" });
  await within(select).findByRole("option", { name: "PHE — PHE" });
  expect(catalog).not.toHaveBeenCalled();
  await userEvent.selectOptions(select, ORG_ID);
  await waitFor(() => expect(catalog).toHaveBeenCalledWith(ORG_ID));
}

/** L25 — a location administrator reads the refusal and no catalog. */
export async function aLocationAdminIsRefused(): Promise<void> {
  const { catalog } = stubAll();
  mount(user("location_admin"));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Symbol libraries are managed by an administrator or an organization administrator.",
  );
  expect(catalog).not.toHaveBeenCalled();
}

// ---- `F3.87` PR 6b: the upload wizard keeps the file outside its values (plan D6) -------------

/** L26 — Submit with no file chosen names the missing file and sends nothing. */
export async function anUploadWithoutAFileIsRefusedAtSubmit(): Promise<void> {
  const { upload } = stubAll();
  mount();
  const card = await openUpload();
  await submitWizard(UPLOAD_DIALOG);
  expect(await within(card).findByRole("alert")).toHaveTextContent("Choose an SVG file to upload.");
  expect(upload).not.toHaveBeenCalled();
}

/**
 * L27 — with a file chosen, the Review step's body passes `bodyProblems` (no alert) and Submit
 * sends the file and the fields: the `File` never entered the wizard's values, whose strict
 * schema would refuse it.
 */
export async function theUploadReviewPassesWithAFileChosen(): Promise<void> {
  const { upload } = stubAll();
  mount();
  const card = await openUpload();
  const file = new File(["<svg/>"], "pump.svg", { type: "image/svg+xml" });
  // The file is chosen last, so nothing typed after it could rebuild the values without it.
  await userEvent.type(within(card).getByRole("textbox", { name: "Symbol label" }), "Pump");
  await userEvent.upload(within(card).getByLabelText("Symbol file"), file);
  await userEvent.click(within(card).getByRole("button", { name: "Next" }));
  expect(within(card).queryByRole("alert")).toBeNull();
  expect(within(card).getByRole("button", { name: "Submit" })).toBeEnabled();
  await userEvent.click(within(card).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(upload).toHaveBeenCalledWith(PLANT_ID, { file, name: undefined, label: "Pump", group: undefined }));
}

// ---- `F3.87` PR 6b: a second action while a wizard is open remounts it with the new start ------

/**
 * L28 — the group of one symbol, then another symbol's Active box: the open wizard takes the
 * second symbol's change, and the first change goes nowhere. Mutation: drop the
 * `SymbolUpdateWizard` `key` => red (it PATCHes the second symbol with the first's group).
 */
export async function aSecondSymbolActionReplacesTheOpenWizard(): Promise<void> {
  const { updateSymbol } = stubAll();
  mount();
  const card = await plantCard();
  await userEvent.selectOptions(within(card).getByRole("combobox", { name: "Group of Inlet screen" }), "hvac");
  await screen.findByRole("dialog", { name: "Edit Inlet screen" });
  await userEvent.click(within(card).getByRole("checkbox", { name: "Active Old pump" }));
  await submitWizard("Edit Old pump");
  const oldPump = orgSymbolFixture("org.plant:old-pump", "Old pump", false);
  await waitFor(() => expect(updateSymbol).toHaveBeenCalledWith(PLANT_ID, oldPump.id, { active: true }));
  expect(updateSymbol).toHaveBeenCalledTimes(1);
}

/**
 * L29 — Edit, then Retire on the same card: the open wizard becomes the Retire wizard with
 * `active: false` in it. Mutation: drop the `LibraryUpdateWizard` `key` => red (the values stay
 * `{}`).
 */
export async function retireAfterEditReplacesTheOpenWizard(): Promise<void> {
  const { updateLibrary } = stubAll();
  mount();
  const card = await plantCard();
  await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
  await screen.findByRole("dialog", { name: "Edit Plant" });
  await userEvent.click(within(card).getByRole("button", { name: "Retire" }));
  await submitWizard("Retire Plant");
  await waitFor(() => expect(updateLibrary).toHaveBeenCalledWith(PLANT_ID, { active: false }));
}

/**
 * L30 — a label typed with no file chosen still asks before Cancel leaves: the shell marks
 * itself on the field's `change`, so the page's `dirty` need only cover the file input.
 */
export async function aTypedLabelWithoutAFileAsksBeforeCancel(): Promise<void> {
  stubAll();
  mount();
  const card = await openUpload();
  await userEvent.type(within(card).getByRole("textbox", { name: "Symbol label" }), "Pump");
  await userEvent.click(within(card).getByRole("button", { name: "Cancel" }));
  expect(await screen.findByRole("alertdialog", { name: "Leave the wizard" })).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: UPLOAD_DIALOG })).toBeInTheDocument();
}
