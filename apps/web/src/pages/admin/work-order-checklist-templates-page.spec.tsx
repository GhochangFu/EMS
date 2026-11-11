import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { WorkOrderChecklistTemplateDto } from "@bms/shared";

import * as organizationsApi from "../../api/admin/organizations";
import * as api from "../../api/admin/work-order-checklist-templates";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import * as vocabulariesApi from "../../api/vocabularies";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import type { AuthUser } from "../../stores/auth-store";
import { WorkOrderChecklistTemplatesAdminPage } from "./work-order-checklist-templates-page";

/**
 * `E3.1` (ADR 0122 decision 4.2/4.3) — the Checklist Templates admin screen,
 * rendered (ADR 0042). Assertions live here; the `.test.tsx` is the Vitest entry
 * point and carries the jsdom docblock. Every read is stubbed with `vi.spyOn`
 * (`F4.160`).
 */

function userOf(role: string): AuthUser {
  return { id: "u1", email: "u@bms.local", displayName: "U", role } as unknown as AuthUser;
}

const ORG_ID = "11111111-1111-4111-8111-111111111111";

function template(over: Partial<WorkOrderChecklistTemplateDto> & Pick<WorkOrderChecklistTemplateDto, "id" | "name">): WorkOrderChecklistTemplateDto {
  return {
    organizationId: ORG_ID,
    domain: null,
    active: true,
    items: [
      { id: `${over.id}-1`, title: "Isolate supply", mandatory: true, sortOrder: 0 },
      { id: `${over.id}-2`, title: "Check terminals", mandatory: false, sortOrder: 1 },
      { id: `${over.id}-3`, title: "Record readings", mandatory: false, sortOrder: 2 },
    ],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

const RETIRED = template({ id: "t-old", name: "Old routine", active: false, domain: null });
const ACTIVE = template({ id: "t-hvac", name: "HVAC service", domain: "hvac" });
const SINGLE = template({
  id: "t-one",
  name: "Single step",
  items: [{ id: "t-one-1", title: "Walk round", mandatory: false, sortOrder: 0 }],
});

function stubAll(items: WorkOrderChecklistTemplateDto[] = [RETIRED, ACTIVE, SINGLE]): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [{ id: ORG_ID, code: "SPECORG", name: "Spec organization" }],
  } as never);
  vi.spyOn(vocabulariesApi, "fetchVocabularies").mockResolvedValue({
    assetDomains: [
      { code: "hvac", label: "HVAC plant", sortOrder: 1, active: true },
      { code: "ups", label: "UPS", sortOrder: 2, active: true },
    ],
  } as never);
  vi.spyOn(api, "fetchAdminChecklistTemplates").mockResolvedValue({ items } as never);
  vi.spyOn(api, "createChecklistTemplate").mockResolvedValue(ACTIVE);
  vi.spyOn(api, "updateChecklistTemplate").mockResolvedValue(ACTIVE);
}

function renderPage(as: AuthUser): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/work-order-checklist-templates"]}>
        <WorkOrderChecklistTemplatesAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function rowOf(name: string): Promise<HTMLElement> {
  await screen.findByText(name);
  const row = document.querySelector<HTMLElement>(`[data-template="${name}"]`);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

async function openEditor(): Promise<HTMLElement> {
  return screen.findByRole("form", { name: "Checklist template" });
}

const SENTENCE = "Checklist templates are managed by an organization administrator or a global administrator.";

/** A `location_admin` and an operator read the sentence; nothing is fetched. */
export async function failsClosedForOtherRoles(): Promise<void> {
  for (const role of ["location_admin", "operator"]) {
    stubAll();
    renderPage(userOf(role));
    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New template" })).toBeNull();
    expect(api.fetchAdminChecklistTemplates).not.toHaveBeenCalled();
    expect(organizationsApi.fetchAdminOrganizations).not.toHaveBeenCalled();
    expect(vocabulariesApi.fetchVocabularies).not.toHaveBeenCalled();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  }
}

/** The list shows name, domain label, item count, the Retired marker; active first. */
export async function listShowsTheTemplatesActiveFirst(): Promise<void> {
  stubAll();
  renderPage(userOf("organization_admin"));
  const hvac = await rowOf("HVAC service");
  expect(api.fetchAdminChecklistTemplates).toHaveBeenCalledWith(ORG_ID);
  await waitFor(() => expect(within(hvac).getByText("HVAC plant")).toBeInTheDocument());
  expect(within(hvac).getByText("3 items")).toBeInTheDocument();
  expect(within(hvac).queryByText("Retired")).toBeNull();
  const single = await rowOf("Single step");
  expect(within(single).getByText("All domains")).toBeInTheDocument();
  expect(within(single).getByText("1 item")).toBeInTheDocument();
  const old = await rowOf("Old routine");
  expect(within(old).getByText("Retired")).toBeInTheDocument();
  expect(within(old).getByRole("button", { name: "Restore" })).toBeInTheDocument();
  const order = Array.from(document.querySelectorAll("[data-template]")).map((el) => el.getAttribute("data-template"));
  expect(order[order.length - 1]).toBe("Old routine");
}

/** With none, the empty sentence. */
export async function emptyListSaysSo(): Promise<void> {
  stubAll([]);
  renderPage(userOf("admin"));
  expect(await screen.findByText("No checklist templates yet.")).toBeInTheDocument();
}

/** Creating sends the trimmed name, domain null, and the items in order with their flags. */
export async function createSendsTrimmedNameNullDomainAndItems(): Promise<void> {
  stubAll();
  const user = userEvent.setup();
  renderPage(userOf("admin"));
  await user.click(await screen.findByRole("button", { name: "New template" }));
  const form = await openEditor();
  const save = within(form).getByRole("button", { name: "Save template" });
  expect(save).toBeDisabled();
  await user.type(within(form).getByLabelText("Template name"), "  Monthly check  ");
  await user.type(within(form).getByLabelText("Item 1 title"), "  Inspect  ");
  await user.click(within(form).getByLabelText("Item 1 is mandatory"));
  await user.click(within(form).getByRole("button", { name: "Add item" }));
  await user.type(within(form).getByLabelText("Item 2 title"), "Sign off");
  expect(save).toBeEnabled();
  await user.click(save);
  await waitFor(() =>
    expect(api.createChecklistTemplate).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      name: "Monthly check",
      domain: null,
      items: [
        { title: "Inspect", mandatory: true },
        { title: "Sign off", mandatory: false },
      ],
    }),
  );
  await waitFor(() => expect(screen.queryByRole("form", { name: "Checklist template" })).toBeNull());
}

/** Reordering and removing change what is sent; an edit sends a PATCH with the whole list. */
export async function editSendsTheWholeReorderedList(): Promise<void> {
  stubAll();
  const user = userEvent.setup();
  renderPage(userOf("organization_admin"));
  const row = await rowOf("HVAC service");
  await user.click(within(row).getByRole("button", { name: "Edit" }));
  const form = await openEditor();
  expect(within(form).getByLabelText("Template name")).toHaveValue("HVAC service");
  expect(within(form).getByLabelText("Item 1 title")).toHaveValue("Isolate supply");
  expect(within(form).getByRole("button", { name: "Move item 1 up" })).toBeDisabled();
  expect(within(form).getByRole("button", { name: "Move item 3 down" })).toBeDisabled();
  await user.click(within(form).getByRole("button", { name: "Move item 1 down" }));
  await user.click(within(form).getByRole("button", { name: "Move item 3 up" }));
  // now: Check terminals, Record readings, Isolate supply
  await user.click(within(form).getByRole("button", { name: "Remove item 2" }));
  await user.click(within(form).getByRole("button", { name: "Save template" }));
  await waitFor(() =>
    expect(api.updateChecklistTemplate).toHaveBeenCalledWith("t-hvac", {
      name: "HVAC service",
      domain: "hvac",
      items: [
        { title: "Check terminals", mandatory: false },
        { title: "Isolate supply", mandatory: true },
      ],
    }),
  );
}

/** A single item cannot be removed; a short name or empty title disables Save; Cancel sends nothing. */
export async function saveGuardsAndCancel(): Promise<void> {
  stubAll();
  const user = userEvent.setup();
  renderPage(userOf("admin"));
  await user.click(await screen.findByRole("button", { name: "New template" }));
  const form = await openEditor();
  expect(within(form).getByRole("button", { name: "Remove item 1" })).toBeDisabled();
  const save = within(form).getByRole("button", { name: "Save template" });
  await user.type(within(form).getByLabelText("Template name"), "ab");
  await user.type(within(form).getByLabelText("Item 1 title"), "Do it");
  expect(save).toBeDisabled();
  await user.type(within(form).getByLabelText("Template name"), "c");
  expect(save).toBeEnabled();
  await user.clear(within(form).getByLabelText("Item 1 title"));
  expect(save).toBeDisabled();
  expect(within(form).getByText(/Saving replaces the template's whole item list/)).toBeInTheDocument();
  await user.click(within(form).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("form", { name: "Checklist template" })).toBeNull();
  expect(api.createChecklistTemplate).not.toHaveBeenCalled();
  expect(api.updateChecklistTemplate).not.toHaveBeenCalled();
}

/** Retire sends `{ active: false }`, Restore `{ active: true }`. */
export async function retireAndRestoreSendTheActiveFlag(): Promise<void> {
  stubAll();
  const user = userEvent.setup();
  renderPage(userOf("admin"));
  const hvac = await rowOf("HVAC service");
  await user.click(within(hvac).getByRole("button", { name: "Retire" }));
  await waitFor(() => expect(api.updateChecklistTemplate).toHaveBeenCalledWith("t-hvac", { active: false }));
  const old = await rowOf("Old routine");
  await user.click(within(old).getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(api.updateChecklistTemplate).toHaveBeenCalledWith("t-old", { active: true }));
}

/** A refusal shows the server's sentence and keeps the editor open. */
export async function refusalShowsTheServersSentence(): Promise<void> {
  stubAll();
  vi.mocked(api.createChecklistTemplate).mockRejectedValue(new Error("A template with that name already exists."));
  const user = userEvent.setup();
  renderPage(userOf("admin"));
  await user.click(await screen.findByRole("button", { name: "New template" }));
  const form = await openEditor();
  await user.type(within(form).getByLabelText("Template name"), "Monthly check");
  await user.type(within(form).getByLabelText("Item 1 title"), "Inspect");
  await user.click(within(form).getByRole("button", { name: "Save template" }));
  const alert = await within(form).findByRole("alert");
  expect(alert).toHaveTextContent("A template with that name already exists.");
}
