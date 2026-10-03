import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AiAssistantSettingsDto } from "@bms/shared";

import * as api from "../../api/admin/ai-assistant";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { AiAssistantPage } from "./ai-assistant-page";

/**
 * `F3.21` (ADR 0090 Amendment 1 A6, A7) — the AI assistant page, rendered
 * (ADR 0042). Assertions live here; `ai-assistant-page.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock.
 *
 * The harness is `onboarding-chat-page.spec.tsx`'s: the real component on its
 * real route (a bare `MemoryRouter` leaves `useParams().orgId` undefined), real
 * TanStack Query, `vi.spyOn` on the API module.
 */

const ORG_ID = "33333333-3333-4333-8333-333333333333";

const USER: AuthUser = {
  id: "u1",
  email: "org-admin@bms.local",
  displayName: "Org admin",
  role: "organization_admin",
};

const PLATFORM: AiAssistantSettingsDto["platform"] = {
  provider: "openai",
  model: "gpt-4o-mini",
  keySet: true,
};

/** No organization row: the platform default answers. */
const PLATFORM_DTO: AiAssistantSettingsDto = {
  source: "platform",
  provider: "openai",
  model: "gpt-4o-mini",
  keySet: true,
  keyLast4: null,
  updatedAt: null,
  platform: PLATFORM,
};

/** The organization's own OpenRouter row with a stored key. */
const ORG_DTO: AiAssistantSettingsDto = {
  source: "organization",
  provider: "openrouter",
  model: "z-ai/glm-5.3-flash",
  keySet: true,
  keyLast4: "9xyz",
  updatedAt: "2026-10-03T08:15:00.000Z",
  platform: PLATFORM,
};

/** The server's own sentence for a key it cannot encrypt (`NO_ENCRYPTION_KEY_MESSAGE`). */
const NO_ENCRYPTION_KEY_MESSAGE =
  "CREDENTIAL_ENCRYPTION_KEY is not configured, so the key cannot be stored encrypted. Nothing was saved.";

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/organizations/${ORG_ID}/ai-assistant`]}>
        <Routes>
          <Route
            path="/admin/organizations/:orgId/ai-assistant"
            element={<AiAssistantPage user={USER} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubGet(dto: AiAssistantSettingsDto): void {
  vi.spyOn(api, "fetchAiAssistantSettings").mockResolvedValue(dto);
}

/** Waits for the form, which renders only once the GET has landed. */
async function providerSelect(): Promise<HTMLSelectElement> {
  return (await screen.findByLabelText("Provider")) as HTMLSelectElement;
}

function keyInput(): HTMLInputElement {
  return screen.getByLabelText("API key") as HTMLInputElement;
}

/**
 * The F4.106 rule, as `onboarding-chat-page.spec.tsx` states it: reverting the
 * page to `err.message` renders the whole JSON, which still *contains* the
 * sentence, so a presence-only assertion gates nothing. Copied, not imported —
 * that helper is private to its spec.
 */
function expectNoEnvelopeLeak(banner: HTMLElement): void {
  const text = (banner.textContent ?? "").trim();
  for (const leak of ["statusCode", '"error"', "errors"]) {
    expect(text, `the banner leaked "${leak}": ${text}`).not.toContain(leak);
  }
  expect(text.startsWith("{"), `the banner rendered a JSON body: ${text}`).toBe(false);
}

/** With no organization row, Platform default is chosen and the page says what it is. */
export async function rendersThePlatformDefaultWhenNoRow(): Promise<void> {
  stubGet(PLATFORM_DTO);
  renderPage();

  expect((await providerSelect()).value).toBe("platform");
  expect(
    screen.getByText("The platform default is OpenAI, model gpt-4o-mini, key set."),
  ).toBeInTheDocument();
  expect(api.fetchAiAssistantSettings).toHaveBeenCalledWith(ORG_ID);
  // Adjacent negative: the platform key is never described as this organization's.
  expect(screen.queryByText(/Key set, ends in/)).toBeNull();
}

/** An organization row shows its provider, model and the key's last four with the date. */
export async function rendersKeySetEndsInLast4(): Promise<void> {
  stubGet(ORG_DTO);
  renderPage();

  expect((await providerSelect()).value).toBe("openrouter");
  expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("z-ai/glm-5.3-flash");
  expect(screen.getByText("Key set, ends in …9xyz, saved 2026-10-03")).toBeInTheDocument();
  expect(keyInput().value, "the key field is never pre-filled").toBe("");

  // Another provider: the stored line goes, and the model field offers its default.
  await userEvent.selectOptions(screen.getByLabelText("Provider"), "openai");
  const model = screen.getByLabelText("Model") as HTMLInputElement;
  expect(model.value).toBe("");
  expect(model.placeholder).toBe("gpt-4o-mini");
  expect(screen.queryByText(/Key set, ends in/)).toBeNull();
}

/** The key field is a password field, sent once, and emptied after the PUT resolves. */
export async function theKeyFieldIsWriteOnlyAndClearedAfterSave(): Promise<void> {
  stubGet(ORG_DTO);
  const put = vi
    .spyOn(api, "putAiAssistantSettings")
    .mockResolvedValue({ ...ORG_DTO, keyLast4: "5678" });
  renderPage();
  await providerSelect();

  expect(keyInput().type).toBe("password");
  await userEvent.type(keyInput(), "sk-or-new-key-5678");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect(put.mock.calls[0]).toEqual([
    ORG_ID,
    { provider: "openrouter", model: "z-ai/glm-5.3-flash", apiKey: "sk-or-new-key-5678" },
  ]);
  await screen.findByText(/Key set, ends in …5678/);
  expect(keyInput().value, "the key is emptied once the PUT resolves").toBe("");

  // Carried once: a second Save with nothing typed omits the key.
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
  expect(put.mock.calls[1]![1]).not.toHaveProperty("apiKey");
}

/** A Save with the key field empty omits `apiKey`, so the stored key is kept. */
export async function saveWithoutAKeyOmitsApiKey(): Promise<void> {
  stubGet(ORG_DTO);
  const put = vi.spyOn(api, "putAiAssistantSettings").mockResolvedValue(ORG_DTO);
  renderPage();
  await providerSelect();

  const model = screen.getByLabelText("Model");
  await userEvent.clear(model);
  await userEvent.type(model, "moonshot/kimi-k3");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect(put.mock.calls[0]![1]).toEqual({ provider: "openrouter", model: "moonshot/kimi-k3" });
  expect(put.mock.calls[0]![1]).not.toHaveProperty("apiKey");
}

/** Choosing Platform default and saving removes the row: a DELETE, never a PUT. */
export async function platformDefaultCallsDelete(): Promise<void> {
  stubGet(ORG_DTO);
  const del = vi.spyOn(api, "deleteAiAssistantSettings").mockResolvedValue(PLATFORM_DTO);
  const put = vi.spyOn(api, "putAiAssistantSettings").mockResolvedValue(ORG_DTO);
  renderPage();

  await userEvent.selectOptions(await providerSelect(), "platform");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  // Wait for either request, then assert which: waiting on the DELETE alone
  // would turn a PUT into a timeout rather than a failed assertion.
  await waitFor(() => expect(put.mock.calls.length + del.mock.calls.length).toBe(1));
  expect(put, "Platform default must not write a row").not.toHaveBeenCalled();
  expect(del).toHaveBeenCalledWith(ORG_ID);
}

/** Test shows the status as a sentence; the typed key reaches the request and not the page. */
export async function testShowsTheStatusSentence(): Promise<void> {
  stubGet(ORG_DTO);
  const test = vi.spyOn(api, "testAiAssistant").mockResolvedValue({ status: "invalid_key" });
  renderPage();
  await providerSelect();

  await userEvent.type(keyInput(), "sk-or-secret-key-1234");
  await userEvent.click(screen.getByRole("button", { name: "Test" }));

  expect(
    await screen.findByText("The provider refused the key. Check the key and try again."),
  ).toBeInTheDocument();
  expect(test).toHaveBeenCalledWith(ORG_ID, {
    provider: "openrouter",
    model: "z-ai/glm-5.3-flash",
    apiKey: "sk-or-secret-key-1234",
  });
  const text = document.body.textContent ?? "";
  expect(text).not.toContain("sk-or-secret");
  expect(text).not.toContain("invalid_key");
}

/** Off disables the key field (ruling 14) and Test, and saves `{ provider: "off" }` alone. */
export async function offDisablesTheKeyField(): Promise<void> {
  stubGet(ORG_DTO);
  const put = vi.spyOn(api, "putAiAssistantSettings").mockResolvedValue(ORG_DTO);
  renderPage();
  const select = await providerSelect();

  expect(keyInput().disabled, "control: a provider takes a key").toBe(false);
  await userEvent.selectOptions(select, "off");
  expect(keyInput().disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Test" })).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect(put.mock.calls[0]![1]).toEqual({ provider: "off" });
}

/** A refused save shows the server's sentence, not its JSON envelope (F4.106). */
export async function aRefusedSaveShowsTheServersSentence(): Promise<void> {
  stubGet(ORG_DTO);
  vi.spyOn(api, "putAiAssistantSettings").mockRejectedValue(
    new ApiError(
      JSON.stringify({ message: NO_ENCRYPTION_KEY_MESSAGE, error: "Bad Request", statusCode: 400 }),
      400,
    ),
  );
  renderPage();
  await providerSelect();

  await userEvent.type(keyInput(), "sk-or-new-key-5678");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  const banner = await screen.findByRole("alert");
  expect(banner).toHaveTextContent(NO_ENCRYPTION_KEY_MESSAGE);
  expectNoEnvelopeLeak(banner);
}
