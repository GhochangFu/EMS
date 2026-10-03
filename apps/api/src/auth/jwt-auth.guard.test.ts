import { describe, it } from "vitest";

import {
  assertAcceptsTheWebClient,
  assertADisabledRowIsRefused,
  assertAForgedTokenNeverReachesTheDb,
  assertARowLinkedElsewhereIsNotRelinked,
  assertAVerifiedUnlinkedRowIsLinked,
  assertEmailVerifiedIsFalseForANonTrueClaim,
  assertEmailVerifiedNeedsTheClaimAndAnEmail,
  assertLocalModeResolvesById,
  assertNoEmailClaimNeverLinksByUsername,
  assertNoRowGivesAViewerAnEmptyScope,
  assertNoRowSendsAnAdminClaimTo403,
  assertRefusesAnotherClientsToken,
  assertRefusesAnUnsetClientId,
} from "./jwt-auth.guard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("JwtAuthGuard — the token's client (F3.78, ADR 0089 decision 5)", () => {
  it("accepts azp = bms-web", async () => {
    await assertAcceptsTheWebClient();
  });

  it("refuses azp = bms-api-admin with 'Token was not issued to this application'", async () => {
    await assertRefusesAnotherClientsToken();
  });

  it("refuses an unset OIDC_CLIENT_ID with 'OIDC client id is not configured'", async () => {
    await assertRefusesAnUnsetClientId();
  });
});

describe("JwtAuthGuard — the subject link (F3.78, ADR 0089 decision 4)", () => {
  it("emailVerified is true for email_verified true and a string email", async () => {
    await assertEmailVerifiedNeedsTheClaimAndAnEmail();
  });

  it("emailVerified is false when email_verified is not the boolean true", async () => {
    await assertEmailVerifiedIsFalseForANonTrueClaim();
  });

  it("email_verified true with no email claim never links by preferred_username", async () => {
    await assertNoEmailClaimNeverLinksByUsername();
  });

  it("a verified token with no row links and returns the row", async () => {
    await assertAVerifiedUnlinkedRowIsLinked();
  });

  it("a verified token with no matching row reaches the ADR 0044 403 for an admin claim", async () => {
    await assertNoRowSendsAnAdminClaimTo403();
  });

  it("a verified token with no matching row gives a viewer an empty scope", async () => {
    await assertNoRowGivesAViewerAnEmptyScope();
  });

  it("a row already linked to another subject is not re-linked", async () => {
    await assertARowLinkedElsewhereIsNotRelinked();
  });
});

describe("JwtAuthGuard — a deactivated account (F3.78, ADR 0089 decision 8)", () => {
  it("refuses a disabled row with 'This account is deactivated'", async () => {
    await assertADisabledRowIsRefused();
  });

  it("checks the signature first: a forged token never queries the db", async () => {
    await assertAForgedTokenNeverReachesTheDb();
  });

  it("local mode verifies through JwtService.verify and resolves by id", async () => {
    await assertLocalModeResolvesById();
  });
});
