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

/** Opens the drawer on one MQTT RTU whose config is `config`, and returns its Topic field. */
async function fieldFor(config: Record<string, unknown>): Promise<HTMLElement> {
  stubStart({ ...SESSION, draft: { rtus: [{ ...MQTT_RTU, config }] } });
  renderPage();
  await openPreview();
  return topicField();
}

/** E1 (F4.236) — a legacy `mqttTopic` fills the field, as it fills the Summary. */
export async function aLegacyTopicFillsTheField(): Promise<void> {
  expect(await fieldFor({ mqttTopic: "a/b" })).toHaveValue("a/b");
}

/** E2 — `topic` wins over `mqttTopic` in the field, as `rtuTopic` reads. */
export async function theTopicKeyWinsInTheField(): Promise<void> {
  expect(await fieldFor({ topic: "x/y", mqttTopic: "a/b" })).toHaveValue("x/y");
}

/** E3 — an empty `topic` beside a legacy key shows empty: a string wins, as in `rtuTopic`. */
export async function anEmptyTopicBesideALegacyKeyShowsEmpty(): Promise<void> {
  expect(await fieldFor({ topic: "", mqttTopic: "a/b" })).toHaveValue("");
}

/** E4 — an absent topic shows empty (the placeholder), not the Summary's "-". */
export async function anAbsentTopicShowsEmptyNotADash(): Promise<void> {
  expect(await fieldFor({ host: "h" })).toHaveValue("");
}

/** E5 — whitespace is shown as sent: the field does not trim (F4.234). */
export async function aWhitespaceTopicIsShownAsSent(): Promise<void> {
  expect(await fieldFor({ topic: "  " })).toHaveValue("  ");
}

/**
 * Opens the drawer on one MQTT RTU whose config is `config`, replaces the
 * field with `a/b`, saves, and returns the config the PATCH sent.
 */
async function saveABOver(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  const patch = vi
    .spyOn(api, "patchOnboardingDraft")
    .mockResolvedValue({ ...SESSION, draft: { rtus: [{ ...MQTT_RTU, config: { host: "h", topic: "a/b" } }] } });
  const field = await fieldFor(config);
  await userEvent.clear(field);
  await userEvent.type(field, "a/b");
  await userEvent.click(screen.getByRole("button", { name: "Save topic" }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  const body = patch.mock.calls[0][1] as { rtus: DraftRtu[] };
  return body.rtus[0].config;
}

const LEGACY_WILDCARD = { host: "h", mqttTopic: "a/#" };

/** E7a (F4.236, owner ruling Q4) — Save over a legacy key sends the typed topic. */
export async function theSaveOverALegacyKeySendsTheTopic(): Promise<void> {
  expect((await saveABOver(LEGACY_WILDCARD)).topic).toBe("a/b");
}

/** E8 (F4.236) — Save over a stored topic sends the typed one, not the stored one. */
export async function theSaveOverAStoredTopicSendsTheTypedOne(): Promise<void> {
  expect((await saveABOver({ host: "h", topic: "old/x" })).topic).toBe("a/b");
}

/**
 * E7b (F4.236, owner ruling Q4) — Save drops the legacy `mqttTopic`: the
 * validator's schema check still reads a shadowed one (spec V4c), so a
 * wildcard left there would refuse the draft on a key the page cannot edit.
 */
export async function theSaveOverALegacyKeyDropsIt(): Promise<void> {
  expect(await saveABOver(LEGACY_WILDCARD)).not.toHaveProperty("mqttTopic");
}

/**
 * Opens the drawer on `{ topic: "a/b", mqttTopic: "a/#" }` — the shadowed
 * state V4c refuses — re-enters the same topic, saves, and returns the config
 * the PATCH sent. Save must be enabled here, or the repair takes two saves.
 */
async function saveTheSameTopicOverAShadowedKey(): Promise<Record<string, unknown>> {
  const patch = vi
    .spyOn(api, "patchOnboardingDraft")
    .mockResolvedValue({ ...SESSION, draft: { rtus: [{ ...MQTT_RTU, config: { host: "h", topic: "a/b" } }] } });
  const field = await fieldFor({ host: "h", topic: "a/b", mqttTopic: "a/#" });
  await userEvent.type(field, "x{backspace}");
  await userEvent.click(screen.getByRole("button", { name: "Save topic" }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  const body = patch.mock.calls[0][1] as { rtus: DraftRtu[] };
  return body.rtus[0].config;
}

/** E9a (F4.236, owner ruling) — re-saving the same topic over a shadowed key drops the key. */
export async function theSameTopicOverAShadowedKeyDropsIt(): Promise<void> {
  expect(await saveTheSameTopicOverAShadowedKey()).not.toHaveProperty("mqttTopic");
}

/** E9b (F4.236) — that save still sends the topic it kept. */
export async function theSameTopicOverAShadowedKeyKeepsTheTopic(): Promise<void> {
  expect((await saveTheSameTopicOverAShadowedKey()).topic).toBe("a/b");
}

/** E6 — Save topic stays disabled when the edit equals the legacy topic. */
export async function saveIsDisabledWhenTheEditEqualsTheLegacyTopic(): Promise<void> {
  const field = await fieldFor({ mqttTopic: "a/b" });
  await userEvent.type(field, "x{backspace}");
  expect(screen.getByRole("button", { name: "Save topic" })).toBeDisabled();
}
