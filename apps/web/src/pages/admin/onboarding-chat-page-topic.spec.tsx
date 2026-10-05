import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { OnboardingSessionDto } from "@bms/shared";

import * as api from "../../api/admin/onboarding";
import { ApiError } from "../../lib/api-error";
import {
  expectNoEnvelopeLeak,
  findTheOnlyAlert,
  openPreview,
  renderPage,
  SESSION,
  stubStart,
} from "./onboarding-chat-page.spec";

/**
 * `F4.208` — the Topic field beside each MQTT RTU's credentials row, saved
 * through `PATCH /admin/onboarding/sessions/:id/draft`.
 *
 * Its own file because `onboarding-chat-page.spec.tsx` is near AGENTS.md
 * §4.5's line ceiling; the harness is imported from it, not copied, so both
 * files render the same page on the same route.
 */

type DraftRtu = NonNullable<OnboardingSessionDto["draft"]["rtus"]>[number];

/** A credentialed MQTT RTU with a host and no topic — the guided session's state after the Credentials field. */
const MQTT_RTU: DraftRtu = {
  code: "RTU-1",
  displayName: "Kolkata RTU 1",
  protocol: "mqtt",
  config: { host: "h" },
  credentialsSet: true,
};

const WITH_MQTT_RTU: OnboardingSessionDto = { ...SESSION, draft: { rtus: [MQTT_RTU] } };

/** What the server answers after the save: the same RTU, now with the topic. */
const SAVED: OnboardingSessionDto = {
  ...SESSION,
  draft: { rtus: [{ ...MQTT_RTU, config: { host: "h", topic: "plant/a" } }] },
};

function topicField(code = "RTU-1"): Promise<HTMLElement> {
  return screen.findByRole("textbox", { name: `Topic for ${code}` });
}

/** Opens the drawer, types `plant/a` into RTU-1's Topic field and saves it. */
async function saveATopic(): Promise<void> {
  renderPage();
  await openPreview();
  await userEvent.type(await topicField(), "plant/a");
  await userEvent.click(screen.getByRole("button", { name: "Save topic" }));
}

function stubPatch(): ReturnType<typeof vi.spyOn> {
  stubStart(WITH_MQTT_RTU);
  return vi.spyOn(api, "patchOnboardingDraft").mockResolvedValue(SAVED);
}

/** W1 — the save sends the typed topic in the RTU's `config`. */
export async function theTopicSaveSendsTheTopic(): Promise<void> {
  const patch = stubPatch();
  await saveATopic();
  await waitFor(() => expect(patch).toHaveBeenCalled());
  expect(patch).toHaveBeenCalledWith(
    "session-1",
    expect.objectContaining({
      rtus: [expect.objectContaining({ config: expect.objectContaining({ topic: "plant/a" }) })],
    }),
  );
}

/** W2 — the rest of the RTU's `config` goes with it: `rtus` replaces the stored list wholesale. */
export async function theTopicSaveKeepsTheRestOfTheConfig(): Promise<void> {
  const patch = stubPatch();
  await saveATopic();
  await waitFor(() => expect(patch).toHaveBeenCalled());
  const body = patch.mock.calls[0]?.[1] as OnboardingSessionDto["draft"];
  expect(body.rtus?.[0]?.config.host).toBe("h");
}

/** W3 — the drawer shows the saved draft: the Summary names the new topic. */
export async function theSavedTopicReachesTheSummary(): Promise<void> {
  stubPatch();
  await saveATopic();
  expect(await screen.findByText(/topic plant\/a/)).toBeInTheDocument();
}

/** W4 — a refused save shows the server's sentence in the drawer's banner, not its envelope. */
export async function aRefusedTopicSaveShowsTheReason(): Promise<void> {
  stubStart(WITH_MQTT_RTU);
  vi.spyOn(api, "patchOnboardingDraft").mockRejectedValue(
    new ApiError('{"message":"Session is not editable","error":"Forbidden","statusCode":403}', 403),
  );
  await saveATopic();
  const banner = await findTheOnlyAlert();
  expect(banner).toHaveTextContent("Session is not editable");
  expectNoEnvelopeLeak(banner);
}

/** W5 — the field stops at the width of `bms.rtus.mqtt_topic`. */
export async function theTopicFieldIsBoundedAt255(): Promise<void> {
  stubStart(WITH_MQTT_RTU);
  renderPage();
  await openPreview();
  expect(await topicField()).toHaveAttribute("maxLength", "255");
}

/** W6 — only an MQTT RTU has a topic: a Modbus RTU beside it gets no field. */
export async function aModbusRtuHasNoTopicField(): Promise<void> {
  const modbus: DraftRtu = { code: "RTU-2", displayName: "Pump RTU", protocol: "modbus_tcp", config: {}, credentialsSet: false };
  stubStart({ ...SESSION, draft: { rtus: [MQTT_RTU, modbus] } });
  renderPage();
  await openPreview();
  expect(await topicField("RTU-1"), "the MQTT RTU has its field").toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Topic for RTU-2" })).toBeNull();
}

/** Opens the drawer and types `plant/a` into RTU-1's Topic field; Save topic is enabled then. */
async function typeATopic(): Promise<HTMLElement> {
  renderPage();
  await openPreview();
  await userEvent.type(await topicField(), "plant/a");
  const save = screen.getByRole("button", { name: "Save topic" });
  expect(save, "Save topic is enabled before the other write starts").toBeEnabled();
  return save;
}

/** W7 — Save topic is disabled while a chat turn is in flight: both write the `rtus` list. */
export async function theTopicSaveWaitsForAChatTurn(): Promise<void> {
  stubStart(WITH_MQTT_RTU);
  vi.spyOn(api, "sendOnboardingChat").mockReturnValue(new Promise(() => undefined));
  const save = await typeATopic();
  await userEvent.type(screen.getByPlaceholderText(/Type a message/), "add another RTU");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(save).toBeDisabled());
}

/** W8 — Save topic is disabled while a credentials save is in flight. */
export async function theTopicSaveWaitsForACredentialSave(): Promise<void> {
  stubStart({ ...SESSION, draft: { rtus: [{ ...MQTT_RTU, credentialsSet: false }] } });
  vi.spyOn(api, "setOnboardingCredentials").mockReturnValue(new Promise(() => undefined));
  const save = await typeATopic();
  await userEvent.click(screen.getByRole("button", { name: "Add credentials" }));
  await userEvent.type(screen.getByPlaceholderText("Username"), "rtu-reader");
  await userEvent.click(screen.getByRole("button", { name: "Save encrypted" }));
  await waitFor(() => expect(save).toBeDisabled());
}
