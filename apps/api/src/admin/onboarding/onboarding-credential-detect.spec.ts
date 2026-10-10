import { MQTT_RTU_ADDED_REPLY, mqttRtusWaitingPrompt } from "./onboarding-chat-summaries";
import { looksLikeCredential, scrubMessages } from "./onboarding-credential-detect";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** ADR 0022 decision 4 — scrubbing, plus the wizard's own live copy passing the re-exported predicate. */
export function runCredentialDetectTests(): void {
  // F4.208: the live copy, which since review also names the topic route.
  for (const message of [MQTT_RTU_ADDED_REPLY, mqttRtusWaitingPrompt(2)]) {
    assert(!looksLikeCredential(message), `must allow: ${JSON.stringify(message)}`);
  }

  // --- scrubMessages: defence in depth (decision 4) ------------------------
  const scrubbed = scrubMessages([
    { role: "user", content: "password: hunter2" },
    { role: "assistant", content: "MQTT RTU added." },
    { role: "user", content: "Add point key kw" },
  ]);
  assert(scrubbed.length === 3, "scrubbing preserves the turn count");
  assert(
    !JSON.stringify(scrubbed).includes("hunter2"),
    "a stored secret never reaches the client, even if decision 2 let it through",
  );
  assert(
    scrubbed[1].content === "MQTT RTU added.",
    "innocent turns are returned unchanged",
  );
  assert(
    scrubbed[2].content === "Add point key kw",
    "and so are point-key turns",
  );
  assert(
    scrubbed[0].content.includes("[REDACTED]"),
    "a redacted turn says so rather than vanishing",
  );

  // Shape tolerance: these rows come from jsonb written by older code.
  const odd = scrubMessages([
    { role: "user" } as never,
    null as never,
    { role: "user", content: 42 } as never,
  ]);
  assert(odd.length === 3, "malformed stored turns are not dropped silently");
}
