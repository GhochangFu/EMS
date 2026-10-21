import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  aChangeWithoutAPreconditionListsANullIfMatch,
  aSweptRowIsNeverAwaited,
  latestFinishedIgnoresAChangeOlderThanTheStuckWindow,
  latestFinishedIsNullWhilePendingOrApplying,
  latestFinishedIsTheNewestRecordedChange,
  theRealTimestampsCompose,
  aClaimReturnsThePreconditionItWasProposedWith,
  aKpiOnlyProposalKeepsTheStoredSections,
  aMissingAssetTemplateIsTheSameRefusal,
  anAssetTemplateOutsideTheAllowedSetIsTheSingleRefusal,
  anAssetTemplateResolvesInAnAllowedOrganization,
  anAssetTemplateTheCallerMayNotManageIsTheSameRefusal,
  anExpiredChangeCannotBePeekedOrClaimed,
  aPublishOfAnAllowedDraftStoresAnEmptyBody,
  ASSET_TEMPLATE_A_CONTENT,
  type AssetTemplateCtx,
  aThrowingManageCheckIsTheSameRefusal,
  anotherUserCannotPeekOrClaim,
  aProposalIsOpenForItsUserUntilRejected,
  concurrentClaimsApplyOnce,
  concurrentProposalsStoreOne,
  discardRejectsOnlyPendingRows,
  finishedReadsOnlyAFinishedChange,
  newConversation,
  openMeansPendingAndUnexpiredOrApplying,
  type PendingCtx,
  type ProposeCtx,
  theResolverChecksACreatesOrganizationAndRefs,
  theResolverDoesNotFindAnAssetTemplateOutsideTheAllowedSet,
  theResolverReadsATargetOnlyInTheAllowedSet,
  recordMovesOnlyAnApplyingRow,
  releaseReturnsAClaimToPending,
  theOwnerIsBoundOnMessagesAndPendingChanges,
  theSweepResolvesStuckClaimsFromTheAuditLog,
} from "./copilot-pending-changes.integration.spec";

const connectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the copilot pending-change claim",
  because:
    "a confirmed copilot change must apply exactly once and only for its own user (ADR 0099 decision 4.5); " +
    "only a real database can show that concurrent claims serialise and that the policy confines each one.",
  connection: "owner",
});

const superuserConnectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the pending-change fixture users",
  because:
    "Only the superuser inserts and deletes a bms.users row under FORCE. Setup and teardown alone use it.",
  connection: "superuser",
});

const FAMILY = `F385-PENDING-${Date.now()}`;
const FAMILY_PATTERN = "F385-PENDING-%";

describe.skipIf(!connectionString)("F3.85 — the copilot pending-change claim (migration 0105)", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let superPool: pg.Pool;
  let ctx: PendingCtx;
  let proposeCtx: ProposeCtx;
  let assetTemplateCtx: AssetTemplateCtx;
  let orgId: string | undefined;
  let orgBId: string | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F3.85");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.85",
    );
    superPool = await openIntegrationPool(superuserConnectionString as string, "F3.85");
    // A run killed before afterAll leaves its organization; the audit rows, users and their rows go with it.
    const stale = `SELECT id FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`;
    await superPool.query(`DELETE FROM bms.audit_log WHERE organization_id IN (${stale})`, [FAMILY_PATTERN]);
    await superPool.query(`DELETE FROM bms.users WHERE organization_id IN (${stale})`, [FAMILY_PATTERN]);
    await superPool.query(`DELETE FROM bms.dashboard_templates WHERE organization_id IN (${stale})`, [FAMILY_PATTERN]);
    await superPool.query(`DELETE FROM bms.asset_templates WHERE organization_id IN (${stale})`, [FAMILY_PATTERN]);
    await superPool.query(`DELETE FROM bms.locations WHERE organization_id IN (${stale})`, [FAMILY_PATTERN]);
    await superPool.query(`DELETE FROM bms.organizations WHERE id IN (${stale})`, [FAMILY_PATTERN]);
    const org = await superPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, 'F3.85 pending changes', 'INR') RETURNING id",
      [FAMILY],
    );
    orgId = org.rows[0]?.id;
    if (!orgId) throw new Error("F3.85: fixture organization was not created");
    const user = async (suffix: string): Promise<string> => {
      const { rows } = await superPool.query<{ id: string }>(
        "INSERT INTO bms.users (organization_id, email, display_name, role) VALUES ($1, $2, $3, 'organization_admin') RETURNING id",
        [orgId, `${FAMILY.toLowerCase()}-${suffix}@example.test`, `F3.85 ${suffix}`],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error(`F3.85: fixture user ${suffix} was not created`);
      return id;
    };
    ctx = { tenantDb: createDb(tenantPool), ownerPool, orgA: orgId, userA: await user("a"), userB: await user("b") };

    // F3.85 PR 8: a second organization, a template and a location in each, and a conversation of A's.
    const orgB = await superPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, 'F3.85 pending changes B', 'INR') RETURNING id",
      [`${FAMILY}-B`],
    );
    orgBId = orgB.rows[0]?.id;
    if (!orgBId) throw new Error("F3.85: fixture organization B was not created");
    const template = async (org: string, suffix: string): Promise<string> => {
      const { rows } = await superPool.query<{ id: string }>(
        "INSERT INTO bms.dashboard_templates (organization_id, code, name, section) VALUES ($1, $2, $3, 'electrical') RETURNING id",
        [org, `f385-t-${suffix.toLowerCase()}`, `F385 template ${suffix}`],
      );
      return rows[0]?.id as string;
    };
    const location = async (org: string, suffix: string): Promise<string> => {
      const code = `${FAMILY}-L${suffix}`.toLowerCase();
      const { rows } = await superPool.query<{ id: string }>(
        "INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude) VALUES ($1, $2, $2, $3, 'pump_station', 0, 0) RETURNING id",
        [org, code, `F3.85 site ${suffix}`],
      );
      return rows[0]?.id as string;
    };
    const base = { ...ctx, orgB: orgBId, conversationA: "" };
    proposeCtx = {
      ...base,
      conversationA: await newConversation(base),
      templateA: await template(orgId, "A"),
      templateB: await template(orgBId, "B"),
      locationA: await location(orgId, "A"),
      locationB: await location(orgBId, "B"),
    };

    // F3.85 PR 11a: an asset template in each organization; A holds an alarms section (ruling Q10).
    const assetTemplate = async (org: string, suffix: string, content: object): Promise<string> => {
      const { rows } = await superPool.query<{ id: string }>(
        "INSERT INTO bms.asset_templates (organization_id, code, name, asset_type, domain, content) VALUES ($1, $2, $3, 'meter', 'electrical', $4) RETURNING id",
        [org, `f385-at-${suffix.toLowerCase()}`, `F385 asset template ${suffix}`, JSON.stringify(content)],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error(`F3.85: fixture asset template ${suffix} was not created`);
      return id;
    };
    assetTemplateCtx = {
      ...proposeCtx,
      assetTemplateA: await assetTemplate(orgId, "A", ASSET_TEMPLATE_A_CONTENT),
      assetTemplateB: await assetTemplate(orgBId, "B", {}),
    };
  });

  afterAll(async () => {
    for (const id of [orgId, orgBId]) {
      if (!id) continue;
      await superPool.query("DELETE FROM bms.audit_log WHERE organization_id = $1", [id]);
      await superPool.query("DELETE FROM bms.copilot_pending_changes WHERE organization_id = $1", [id]);
      await superPool.query("DELETE FROM bms.users WHERE organization_id = $1", [id]);
      await superPool.query("DELETE FROM bms.dashboard_templates WHERE organization_id = $1", [id]);
      await superPool.query("DELETE FROM bms.asset_templates WHERE organization_id = $1", [id]);
      await superPool.query("DELETE FROM bms.locations WHERE organization_id = $1", [id]);
      await superPool.query("DELETE FROM bms.organizations WHERE id = $1", [id]);
    }
    await Promise.all([ownerPool?.end(), tenantPool?.end(), superPool?.end()]);
  });

  it("concurrentClaimsApplyOnce", async () => {
    await concurrentClaimsApplyOnce(ctx);
  });
  it("anotherUserCannotPeekOrClaim", async () => {
    await anotherUserCannotPeekOrClaim(ctx);
  });
  it("anExpiredChangeCannotBePeekedOrClaimed", async () => {
    await anExpiredChangeCannotBePeekedOrClaimed(ctx);
  });
  it("releaseReturnsAClaimToPending", async () => {
    await releaseReturnsAClaimToPending(ctx);
  });
  it("recordMovesOnlyAnApplyingRow", async () => {
    await recordMovesOnlyAnApplyingRow(ctx);
  });
  it("theSweepResolvesStuckClaimsFromTheAuditLog", async () => {
    await theSweepResolvesStuckClaimsFromTheAuditLog(ctx);
  });
  it("theOwnerIsBoundOnMessagesAndPendingChanges", async () => {
    await theOwnerIsBoundOnMessagesAndPendingChanges(ctx);
  });
  it("aProposalIsOpenForItsUserUntilRejected", async () => {
    await aProposalIsOpenForItsUserUntilRejected(proposeCtx);
  });
  it("openMeansPendingAndUnexpiredOrApplying", async () => {
    await openMeansPendingAndUnexpiredOrApplying(proposeCtx);
  });
  it("finishedReadsOnlyAFinishedChange", async () => {
    await finishedReadsOnlyAFinishedChange(proposeCtx);
  });
  it("concurrentProposalsStoreOne", async () => {
    await concurrentProposalsStoreOne(proposeCtx);
  });
  it("discardRejectsOnlyPendingRows", async () => {
    await discardRejectsOnlyPendingRows(proposeCtx);
  });
  it("theResolverReadsATargetOnlyInTheAllowedSet", async () => {
    await theResolverReadsATargetOnlyInTheAllowedSet(proposeCtx);
  });
  it("theResolverChecksACreatesOrganizationAndRefs", async () => {
    await theResolverChecksACreatesOrganizationAndRefs(proposeCtx);
  });
  it("aThrowingManageCheckIsTheSameRefusal", async () => {
    await aThrowingManageCheckIsTheSameRefusal(proposeCtx);
  });
  it("anAssetTemplateResolvesInAnAllowedOrganization", async () => {
    await anAssetTemplateResolvesInAnAllowedOrganization(assetTemplateCtx);
  });
  it("theResolverDoesNotFindAnAssetTemplateOutsideTheAllowedSet", async () => {
    await theResolverDoesNotFindAnAssetTemplateOutsideTheAllowedSet(assetTemplateCtx);
  });
  it("anAssetTemplateOutsideTheAllowedSetIsTheSingleRefusal", async () => {
    await anAssetTemplateOutsideTheAllowedSetIsTheSingleRefusal(assetTemplateCtx);
  });
  it("aMissingAssetTemplateIsTheSameRefusal", async () => {
    await aMissingAssetTemplateIsTheSameRefusal(assetTemplateCtx);
  });
  it("anAssetTemplateTheCallerMayNotManageIsTheSameRefusal", async () => {
    await anAssetTemplateTheCallerMayNotManageIsTheSameRefusal(assetTemplateCtx);
  });
  it("aPublishOfAnAllowedDraftStoresAnEmptyBody", async () => {
    await aPublishOfAnAllowedDraftStoresAnEmptyBody(assetTemplateCtx);
  });
  it("aKpiOnlyProposalKeepsTheStoredSections", async () => {
    await aKpiOnlyProposalKeepsTheStoredSections(assetTemplateCtx);
  });
  it("F4.247: aClaimReturnsThePreconditionItWasProposedWith", async () => {
    await aClaimReturnsThePreconditionItWasProposedWith(proposeCtx);
  });
  it("F4.247: aChangeWithoutAPreconditionListsANullIfMatch", async () => {
    await aChangeWithoutAPreconditionListsANullIfMatch(proposeCtx);
  });
  it("F4.244: latestFinishedIsNullWhilePendingOrApplying", async () => {
    await latestFinishedIsNullWhilePendingOrApplying(proposeCtx);
  });
  it("F4.244: latestFinishedIsTheNewestRecordedChange", async () => {
    await latestFinishedIsTheNewestRecordedChange(proposeCtx);
  });
  it("F4.244: latestFinishedIgnoresAChangeOlderThanTheStuckWindow", async () => {
    await latestFinishedIgnoresAChangeOlderThanTheStuckWindow(proposeCtx);
  });
  it("F4.244: aSweptRowIsNeverAwaited", async () => {
    await aSweptRowIsNeverAwaited(proposeCtx);
  });
  it("F4.244: theRealTimestampsCompose", async () => {
    await theRealTimestampsCompose(proposeCtx);
  });
});
