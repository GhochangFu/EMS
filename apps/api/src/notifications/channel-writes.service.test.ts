import { describe, it } from "vitest";

import {
  theCreateAuditCarriesTheChannelsOrganization,
  theCreateAuditIsWrittenOnTheFleetPool,
  theCreateAuditNeverCarriesTheSecret,
  theCreateAuditSaysASecretIsStored,
  theCreateWritesOneAuditRow,
  theRuleChannelSetAuditsThePreservedJoins,
  theUpdateAuditListsTheChangedFields,
  theUpdateAuditRecordsAClear,
  theUpdateAuditRecordsARotation,
} from "./channel-writes.service.spec";

/** `F4.279` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.279 — the channel writes audit through MasterDataAuditService", () => {
  it("a create writes one audit row", async () => {
    await theCreateWritesOneAuditRow();
  });

  it("the create's audit row carries the channel's organization", async () => {
    await theCreateAuditCarriesTheChannelsOrganization();
  });

  it("the create's audit row is written on the fleet pool", async () => {
    await theCreateAuditIsWrittenOnTheFleetPool();
  });

  it("the create's audit payload says a secret is stored", async () => {
    await theCreateAuditSaysASecretIsStored();
  });

  it("the create's audit row never carries the secret", async () => {
    await theCreateAuditNeverCarriesTheSecret();
  });

  it("an update's audit payload lists the changed fields", async () => {
    await theUpdateAuditListsTheChangedFields();
  });

  it("an update's audit payload records a rotated secret", async () => {
    await theUpdateAuditRecordsARotation();
  });

  it("an update's audit payload records a cleared secret", async () => {
    await theUpdateAuditRecordsAClear();
  });

  it("the rule channel set audits the joins it preserved", async () => {
    await theRuleChannelSetAuditsThePreservedJoins();
  });
});
