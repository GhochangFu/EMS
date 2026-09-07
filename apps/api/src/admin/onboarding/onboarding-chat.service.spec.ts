import type { OnboardingDraft } from "@bms/shared";

import { MAX_ECHOED_CELL_CHARS } from "../spreadsheet-guard";
import { OnboardingChatService } from "./onboarding-chat.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The longest a single Excel cell can be. Every hostile string below is exactly this. */
const CELL_MAX = 32_767;

function longCell(fill: string): string {
  return fill.repeat(CELL_MAX);
}

/**
 * `excelImportFollowUp` reads `this.mqttSetupTemplate`,
 * `this.formatAssetsByRtuSummary` and the draft it is handed, and touches none
 * of the four injected services — verified against the method, which is why
 * empty stubs are enough. `onboarding-credentials.spec.ts` is the precedent for
 * this style.
 */
function chatService(): OnboardingChatService {
  return new OnboardingChatService({} as never, {} as never, {} as never, {} as never);
}

/** A draft carrying two RTUs and two assets, all named with 32,767-character cells. */
function hostileDraft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    rtus: [
      {
        code: longCell("C"),
        displayName: longCell("D"),
        protocol: "mqtt",
        config: { host: "phe.thinkiot.co.in", port: 8883, tls: true, topic: "" },
        credentialsSet: false,
        ingestEnabled: true,
      },
      {
        code: longCell("E"),
        displayName: longCell("F"),
        protocol: "mqtt",
        config: { host: "phe.thinkiot.co.in", port: 8883, tls: true, topic: "" },
        credentialsSet: false,
        ingestEnabled: true,
      },
    ],
    assets: [
      { rtuIndex: 0, code: longCell("G"), name: longCell("H"), siteName: "Berhampur", domain: "electrical" },
      { rtuIndex: 1, code: longCell("I"), name: longCell("J"), siteName: "Berhampur", domain: "electrical" },
    ],
    ...overrides,
  };
}

/**
 * `F4.102` — the import summary echoes sheet-supplied text at four places, and
 * before this row none of them was bounded.
 *
 * Measured at `ef1a3e11` through the real path: a workbook of 3,000 RTU rows
 * whose cells each held 32,767 characters produced an `assistantMessage` of
 * **393,235,161 characters**, and at 7,000 rows `excelImportFollowUp` died with
 * `RangeError: Invalid string length`. Those two uploads were 198 MB and
 * 461 MB, so `MAX_IMPORT_FILE_BYTES` (5 MiB) now closes them at the door;
 * `quoteCell` ships anyway (owner ruling 3) because a 5 MiB workbook may still
 * declare tens of MiB inflated, i.e. thousands of maximum-length cells. **No
 * figure is claimed for that residual — it has not been measured.**
 *
 * The three sub-cases exist because `excelImportFollowUp` returns from the
 * first branch that matches. One call cannot reach both `mqttSetupTemplate` and
 * `formatAssetsByRtuSummary`, so a single-call assertion would leave one of the
 * four sites unguarded and green.
 */
export function assertExcelImportFollowUpBoundsEchoedText(): void {
  const service = chatService();

  // --- sites 1 and 3: the location name, and the MQTT paste-back template ---
  // Every RTU is `credentialsSet: false` with a blank topic, so the incomplete
  // branch fires and `mqttSetupTemplate` runs.
  const mqtt = service.excelImportFollowUp(
    hostileDraft(),
    { locationName: longCell("L"), rtuCount: 2, assetCount: 2 },
    [],
    [],
  );
  assert(
    mqtt.assistantMessage.includes("RTU: "),
    "this sub-case must reach the MQTT setup template, or site 3 goes unasserted",
  );
  assert(
    mqtt.assistantMessage.length < 4000,
    `the MQTT follow-up must be bounded, got ${mqtt.assistantMessage.length} characters`,
  );
  assert(
    mqtt.assistantMessage.includes("more characters"),
    "a cut cell says how much was omitted",
  );

  // --- site 4: the assets-by-RTU summary -----------------------------------
  // Credentials set, a real topic, point keys satisfied and no asset points:
  // the only branch left is the one that calls `formatAssetsByRtuSummary`.
  const summaryDraft = hostileDraft({
    onboardingMeta: { useExistingPointKeys: true },
    assetPoints: [],
  });
  for (const rtu of summaryDraft.rtus ?? []) {
    rtu.credentialsSet = true;
    rtu.config.topic = "BERHAMPUR-RTU-1/Topic1";
  }
  const summary = service.excelImportFollowUp(
    summaryDraft,
    { locationName: longCell("L"), rtuCount: 2, assetCount: 2 },
    [],
    [],
  );
  assert(
    summary.assistantMessage.includes("Assets by RTU"),
    "this sub-case must reach the assets summary, or site 4 goes unasserted",
  );
  // Asserted per sub-case on purpose. A length check on the MQTT case alone
  // stays green with site 4's quoting removed, which is exactly the "asserted
  // in one direction only" failure this row exists to correct.
  assert(
    summary.assistantMessage.length < 4000,
    `the assets summary must be bounded, got ${summary.assistantMessage.length} characters`,
  );
  assert(
    summary.assistantMessage.includes("more characters"),
    "a cut cell says how much was omitted",
  );
  // Both halves of site 4 — the RTU display name and each asset name — are
  // interpolated on the same line, so each is checked for its own cut.
  const summaryLine = summary.assistantMessage
    .split("\n")
    .find((line) => line.startsWith("- **"));
  assert(summaryLine !== undefined, "the summary lists one line per RTU");
  assert(
    (String(summaryLine).match(/more characters/g) ?? []).length >= 2,
    `the RTU name and the asset name are each cut, got "${String(summaryLine).slice(0, 200)}"`,
  );

  // --- the other direction: an ordinary name is still readable -------------
  // `quoteCell` adds quotes and nothing else under the bound, so the operator
  // still sees the location they uploaded.
  const ordinary = service.excelImportFollowUp(
    hostileDraft(),
    { locationName: "Berhampur", rtuCount: 2, assetCount: 2 },
    [],
    [],
  );
  const firstLine = ordinary.assistantMessage.split("\n")[0];
  assert(
    firstLine.includes("Berhampur"),
    `a name inside ${MAX_ECHOED_CELL_CHARS} characters is echoed whole, got "${firstLine}"`,
  );
}
