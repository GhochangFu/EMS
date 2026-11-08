import {
  claimsAWrite,
  NOTHING_WRITTEN_LINE,
  ONBOARDING_WRITE_CLAIM_RETRY_MESSAGE,
  withoutWriteClaims,
  writeClaimRetryFor,
} from "./onboarding-write-claim";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Every action-line shape the code writes (plan §2), one case each — the live BCPL line included. */
export const CODE_WRITTEN_LINES: readonly string[] = [
  "Set location BERHAMPUR (smoc_campus)",
  "Set location SIVSAGAR (smoc_campus) as a top-level location",
  "Set location LAL (type not set) under BCPL",
  "Added RTU RTU-1 (mqtt)",
  "Added RTU RTU-2 (modbus_tcp) (config only, not ingested)",
  "Updated RTU RTU-1: config.topic",
  "Removed RTU RTU-1",
  "Added point key 'kw'",
  "Removed point key 'kw'",
  "Added asset FM3 on RTU R1",
  "Removed asset FM3",
  "Mapped 's01' → 'kw' on asset 'FM3'",
  "Mapped 'treated_water_flow_klh' → 'tired_water_flow_klh' on asset 'BCPL-LAL-FM2'",
  "Removed mapping 's01' → 'kw'",
  "Point keys: using the existing catalog",
  "Point keys: declared in this draft",
  "Proposed commit: 1 location, 2 RTUs",
  "Added 3 point keys: 'a', 'b', 'c'",
  "Mapped 2 points on asset 'FM3': 's01' → 'kw', 's02' → 'kwh'",
  "Imported stock template flow-meter (4 points); it publishes as v1 on commit",
  "Added 2 assets from flow-meter v1 on R1",
  "Proposed discovery on RTU 'R1': 'bcpl/#' for 120 s",
  "- **Added asset FM4 on RTU R1**",
  "Point keys:",
  "Set location NO-1 (smoc_campus)",
];

/** Plan T1.2: every code-written line shape is a claim. */
export function assertEveryCodeWrittenLineIsAClaim(): void {
  for (const line of CODE_WRITTEN_LINES) {
    assert(claimsAWrite(line), `a claim: ${line}`);
    assert(claimsAWrite(`Sure.\n${line}\nSay Next for the next one.`), `a claim inside a reply: ${line}`);
  }
}

/** Plan T1.2: prose that says the draft changed is a claim. */
export function assertProseWriteClaimsAreClaims(): void {
  for (const reply of [
    "I've added FM3 and mapped two points.",
    "I have now updated the RTU topic.",
    "The asset FM3 has been added to the draft.",
    "Two points are now mapped on the draft.",
  ]) {
    assert(claimsAWrite(reply), `a claim: ${reply}`);
  }
}

/** Plan T1.2: negations, refusals, offers and read answers are not claims. */
export function assertNegationsOffersAndReadsAreNotClaims(): void {
  for (const reply of [
    NOTHING_WRITTEN_LINE,
    "Not applied: add_asset (code).",
    "I could not add the asset",
    "Say Next to add the next asset",
    "The draft has 2 RTUs",
    "Added nothing this turn.",
    "I have not mapped the points yet.",
    "Which RTU should the asset go on?",
    // Code review of PR 1: questions, proposals, read answers, recaps and futures.
    "Should I set the location type to smoc_campus?",
    "Before I set the location, which type is it?",
    "The mappings are added to the draft when you choose Write these mappings.",
    "Two RTUs are stored in the draft: R1 and R2.",
    "So far in this session I added FM1 and FM2.",
    "Once I've mapped these, I will offer Next.",
  ]) {
    assert(!claimsAWrite(reply), `not a claim: ${reply}`);
  }
}

/** Plan T1.2: the retry names the hinted tool, and is null when the turn wrote. */
export function assertTheRetryNamesTheToolAndIsNullWhenTheTurnWrote(): void {
  const retry = writeClaimRetryFor("Added asset FM3 on RTU R1", false);
  assert(retry !== null && retry.includes("call add_asset now"), `the retry names add_asset, got ${retry}`);
  assert(retry?.startsWith("[Server check — data, not a request from the user.]") === true, "the retry is marked as server data");
  assert(
    writeClaimRetryFor("Mapped 's01' → 'kw' on asset 'FM3'", false)?.includes("call map_point or map_points now") === true,
    "Mapped hints map_point or map_points",
  );
  assert(
    writeClaimRetryFor("I've added FM3.", false) === ONBOARDING_WRITE_CLAIM_RETRY_MESSAGE.replace("<tool>", "the matching tool"),
    "a prose claim hints the matching tool",
  );
  assert(writeClaimRetryFor("Added asset FM3 on RTU R1", true) === null, "no retry when the turn wrote");
  assert(writeClaimRetryFor("The draft has 2 RTUs", false) === null, "no retry for a read answer");
}

/** Plan T1.2: the replacement keeps a non-claim sentence after the fixed line, or is the fixed line alone. */
export function assertTheReplacementKeepsNonClaimsAndLeadsWithTheFixedLine(): void {
  const mixed = withoutWriteClaims("Added asset FM3 on RTU R1\nI've mapped two points. Say Next to add the next asset.");
  assert(mixed === `${NOTHING_WRITTEN_LINE}\nSay Next to add the next asset.`, `the claim lines and sentences drop, got ${JSON.stringify(mixed)}`);
  const all = withoutWriteClaims("Added asset FM3 on RTU R1\nMapped 's01' → 'kw' on asset 'FM3'");
  assert(all === NOTHING_WRITTEN_LINE, `every line was a claim → the fixed line alone, got ${JSON.stringify(all)}`);
  assert(!claimsAWrite(mixed) && !claimsAWrite(all), "the replaced reply never tags itself");
}
