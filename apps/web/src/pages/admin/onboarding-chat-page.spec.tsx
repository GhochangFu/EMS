import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import type { OnboardingChatResponseDto, OnboardingSessionDto } from "@bms/shared";

import * as api from "../../api/admin/onboarding";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { OnboardingChatPage } from "./onboarding-chat-page";

/**
 * `F4.106` — the onboarding wizard's seven error surfaces, rendered (ADR 0042).
 *
 * Assertions live here; `onboarding-chat-page.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock, because that is
 * the file Vitest collects (ADR 0042 decision 2).
 *
 * ## Why a page test and not a helper test
 *
 * `apiErrorMessage` already has a full spec, and it passed throughout the whole
 * period this screen was rendering raw JSON at seven places. A pure spec over
 * the unwrapper proves nothing about whether an operator ever reaches it. The
 * claim this row makes is about what is on the screen, so the gate is here.
 *
 * ## Two assertion shapes, deliberately, and one is not interchangeable
 *
 * For a body that is this app's ordinary **envelope**, reverting the page to
 * `err.message` renders the whole JSON — which still *contains* the sentence.
 * A presence-only assertion there passes under its own mutation and gates
 * nothing. So every envelope-shaped case asserts both halves: the exact
 * sentence is present, **and** `expectNoEnvelopeLeak` holds.
 *
 * The `PATCH`/`chat` Zod `flatten()` body carries no human sentence at all, but
 * it does carry the field message as a substring — so it gets both halves too,
 * with the presence half pinned to the *formatted* `field: message` shape that
 * the raw body cannot produce.
 *
 * ## What P6 and P7 gate — stated narrowly on purpose
 *
 * They gate the **wiring**, not the unwrapping. After this row's api-layer unit
 * `uploadOnboardingExcel` and `downloadOnboardingTemplate` throw a sentence
 * already, so the page's own `apiErrorMessage` call on those two paths is inert
 * by construction; the unwrapping for them is gated by
 * `api/admin/onboarding.spec.ts`, not by this file. What is alive here is that
 * a rejected promise reaches a banner at all — before this row, both of these
 * failed in silence.
 */

const ORG_ID = "22222222-2222-4222-8222-222222222222";

const USER = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const SESSION: OnboardingSessionDto = {
  id: "session-1",
  organizationId: ORG_ID,
  organizationCode: "IONX",
  organizationName: "Ion Exchange",
  status: "draft",
  currentPhase: "location",
  draft: {},
  messages: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  committedAt: null,
  result: null,
};

/** A session whose one RTU still needs credentials, so the drawer offers the form. */
const SESSION_WITH_RTU: OnboardingSessionDto = {
  ...SESSION,
  draft: {
    rtus: [
      {
        code: "RTU-1",
        displayName: "Kolkata RTU 1",
        protocol: "mqtt",
        config: {},
        credentialsSet: false,
      },
    ],
  },
};

function chatResponse(session: OnboardingSessionDto): OnboardingChatResponseDto {
  return { assistantMessage: "Tell me about the location.", session };
}

/**
 * jsdom implements no scrolling, so `Element.prototype.scrollTo` does not exist
 * and the page's thread-pinning effect throws on mount. Without this every case
 * below would fail for a reason that has nothing to do with error presentation.
 * A no-op is the whole of what these assertions need from it.
 */
function stubScrolling(): void {
  if (typeof HTMLElement.prototype.scrollTo !== "function") {
    HTMLElement.prototype.scrollTo = () => undefined;
  }
}

/**
 * Renders the page **on its real route**.
 *
 * A bare `<MemoryRouter>` leaves `useParams().orgId` undefined, the mount
 * effect never fires and `startMutation` never runs — every case below would
 * then assert nothing while looking green.
 */
function renderPage(): HTMLElement {
  stubScrolling();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/organizations/${ORG_ID}/onboarding`]}>
        <Routes>
          <Route
            path="/admin/organizations/:orgId/onboarding"
            element={<OnboardingChatPage user={USER} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return view.container;
}

/** Every case but the start failure needs the session to exist first. */
function stubStart(session: OnboardingSessionDto = SESSION): void {
  vi.spyOn(api, "createOnboardingSession").mockResolvedValue(chatResponse(session));
}

/**
 * The one banner on screen.
 *
 * Both banners carry `role="alert"` and both can be present at once, so this
 * fails loudly rather than letting a query pick up the other one — a case that
 * asserted the credentials reason against the chat banner would be green for
 * the wrong reason.
 */
async function findTheOnlyAlert(): Promise<HTMLElement> {
  const alerts = await screen.findAllByRole("alert");
  expect(alerts, "exactly one banner belongs on screen for this case").toHaveLength(1);
  return alerts[0] as HTMLElement;
}

/**
 * The absence half of an envelope claim.
 *
 * Without this, "revert to `err.message`" renders the entire JSON body, which
 * still contains the sentence — so the presence half stays green and the
 * assertion gates nothing.
 */
function expectNoEnvelopeLeak(banner: HTMLElement): void {
  const text = (banner.textContent ?? "").trim();
  for (const leak of ["statusCode", '"error"', "errors"]) {
    expect(text, `the banner leaked "${leak}": ${text}`).not.toContain(leak);
  }
  expect(text.startsWith("{"), `the banner rendered a JSON body: ${text}`).toBe(false);
}

/** Opens the draft preview drawer, where Validate, Commit and credentials live. */
async function openPreview(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: /^Preview/ }));
}

/**
 * P1 — a refused **start** shows a sentence, not a Zod `flatten()`.
 *
 * `POST /admin/onboarding/sessions` throws `err.flatten()` verbatim, so the
 * body carries no `message`, `error` or `statusCode` at all — the raw text is
 * the whole JSON object.
 */
export async function aRefusedStartShowsASentenceNotAZodFlatten(): Promise<void> {
  vi.spyOn(api, "createOnboardingSession").mockRejectedValue(
    new ApiError('{"formErrors":[],"fieldErrors":{"organizationId":["Invalid uuid"]}}', 400),
  );
  renderPage();

  const banner = await findTheOnlyAlert();
  // The formatted shape, which the raw body cannot produce: the raw body does
  // contain "Invalid uuid", so a substring match on the message alone would
  // survive the mutation.
  expect(banner).toHaveTextContent("organizationId: Invalid uuid");
  expectNoEnvelopeLeak(banner);
}

/** P2 — a refused **chat turn** shows the server's sentence and leaks no envelope. */
export async function aRefusedChatTurnShowsTheServersSentence(): Promise<void> {
  stubStart();
  vi.spyOn(api, "sendOnboardingChat").mockRejectedValue(
    new ApiError(
      '{"message":"Draft is at its cap of 100 RTUs","error":"Bad Request","statusCode":400}',
      400,
    ),
  );
  renderPage();

  const box = await screen.findByPlaceholderText(/Type a message/);
  await userEvent.type(box, "add another RTU");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));

  const banner = await findTheOnlyAlert();
  expect(banner).toHaveTextContent("Draft is at its cap of 100 RTUs");
  expectNoEnvelopeLeak(banner);
}

/**
 * P3 — a refused **commit** shows the reason and leaks no envelope.
 *
 * `OnboardingCommitService` throws `{ message, errors }` — no `statusCode` and
 * no `error`, a third body shape. `errors` is what the mutation leaks here.
 */
export async function aRefusedCommitShowsTheReason(): Promise<void> {
  stubStart();
  vi.spyOn(api, "commitOnboardingSession").mockRejectedValue(
    new ApiError(
      '{"message":"Draft is not ready to commit","errors":[{"field":"location.code","message":"required"}]}',
      400,
    ),
  );
  renderPage();

  await openPreview();
  await userEvent.click(await screen.findByRole("button", { name: "Commit" }));

  const banner = await findTheOnlyAlert();
  expect(banner).toHaveTextContent("Draft is not ready to commit");
  expectNoEnvelopeLeak(banner);
}

/**
 * P4 — a refused **credential save** shows the reason, in the drawer.
 *
 * The page's own comment names the 503 from an unset `CREDENTIAL_ENCRYPTION_KEY`
 * as the common case here, so that is the fixture.
 */
export async function aRefusedCredentialSaveShowsTheReason(): Promise<void> {
  stubStart(SESSION_WITH_RTU);
  vi.spyOn(api, "setOnboardingCredentials").mockRejectedValue(
    new ApiError(
      '{"message":"Credential storage is not configured","error":"Service Unavailable","statusCode":503}',
      503,
    ),
  );
  renderPage();

  await openPreview();
  await userEvent.click(await screen.findByRole("button", { name: "Add credentials" }));
  await userEvent.type(screen.getByPlaceholderText("Username"), "rtu-reader");
  await userEvent.click(screen.getByRole("button", { name: "Save encrypted" }));

  const banner = await findTheOnlyAlert();
  expect(banner).toHaveTextContent("Credential storage is not configured");
  expectNoEnvelopeLeak(banner);
}

/**
 * P5 — a failed **validate** shows something at all.
 *
 * `validateMutation` has never had an `onError`, so today a refused validation
 * is silence: the drawer's Validate button settles and nothing changes on
 * screen. Presence alone is the live claim here, because the defect is that
 * there is no banner rather than that the banner is wrong.
 */
export async function aFailedValidateShowsSomethingAtAll(): Promise<void> {
  stubStart();
  vi.spyOn(api, "validateOnboardingSession").mockRejectedValue(
    new ApiError(
      '{"message":"Draft has no location to validate","error":"Bad Request","statusCode":400}',
      400,
    ),
  );
  renderPage();

  await openPreview();
  await userEvent.click(await screen.findByRole("button", { name: "Validate" }));

  const banner = await findTheOnlyAlert();
  expect(banner).toHaveTextContent("Draft has no location to validate");
  expectNoEnvelopeLeak(banner);
}

/**
 * P6 — a failed **upload** reaches the chat banner.
 *
 * The fixture is the sentence the api layer throws after this row, because that
 * is what this path really carries: the claim is the `.catch`, not the
 * unwrapping. See this file's header.
 */
export async function aFailedUploadReachesTheChatBanner(): Promise<void> {
  stubStart();
  vi.spyOn(api, "uploadOnboardingExcel").mockRejectedValue(
    new Error("File is too large — the limit is 5 MB."),
  );
  const container = renderPage();

  await screen.findByPlaceholderText(/Type a message/);
  const input = container.querySelector('input[type="file"]');
  expect(input, "the wizard's hidden file input").not.toBeNull();
  await userEvent.upload(
    input as HTMLInputElement,
    new File(["x"], "estate.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );

  const banner = await findTheOnlyAlert();
  expect(banner).toHaveTextContent("File is too large — the limit is 5 MB.");
}

/**
 * P7 — a failed **template download** shows the reason.
 *
 * The button was a bare `void downloadOnboardingTemplate()`: every refusal was
 * an unhandled rejection and the operator saw nothing. The envelope fixture
 * exercises the page's `apiErrorMessage` call as well, but in production the
 * api layer hands this path a sentence already — the claim is the `.catch`.
 */
export async function aFailedTemplateDownloadShowsTheReason(): Promise<void> {
  stubStart();
  vi.spyOn(api, "downloadOnboardingTemplate").mockRejectedValue(
    new ApiError(
      '{"message":"Template download is outside your access scope","error":"Forbidden","statusCode":403}',
      403,
    ),
  );
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Excel template" }));

  const banner = await findTheOnlyAlert();
  expect(banner).toHaveTextContent("Template download is outside your access scope");
  expectNoEnvelopeLeak(banner);
}
