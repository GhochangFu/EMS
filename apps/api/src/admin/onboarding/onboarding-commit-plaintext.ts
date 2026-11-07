import type { OnboardingDraft } from "@bms/shared";

/** One plain-MQTT RTU in the commit audit entry (`F4.326`, plan ruling 7): its code only, never its host. */
export type PlaintextRtuAudit = { readonly code: string; readonly tls: false };

/**
 * `F4.326` / ADR 0114 decision 6 — the `plaintextRtus` field of the
 * `master.onboarding.commit` audit entry: every MQTT RTU the draft commits with
 * the literal `tls: false`, in draft order. Codes only — no host (ruling 7),
 * because the audit row is readable wider than the connection config. The
 * validator has already refused any such RTU whose host is not listed, so
 * every entry here was allowed by `MQTT_PLAINTEXT_HOSTS` at commit time.
 */
export function plaintextRtusOf(draft: Pick<OnboardingDraft, "rtus">): PlaintextRtuAudit[] {
  return (draft.rtus ?? [])
    .filter((rtu) => rtu.protocol === "mqtt" && rtu.config?.tls === false)
    .map((rtu) => ({ code: rtu.code, tls: false as const }));
}
