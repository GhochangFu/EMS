import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";

import { onboardingSessions, organizations, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { ONBOARDING_DRAFT_LIST_LIMIT, onboardingDraftListDtoSchema } from "@bms/shared";
import type {
  JwtPayload,
  OnboardingChatMessage,
  OnboardingChatResponseDto,
  OnboardingDraft,
  OnboardingDraftListDto,
  OnboardingPhase,
  OnboardingSessionDto,
  OnboardingValidateResponseDto,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { recalledIdentity, resolveActorId } from "../../auth/identity-resolver";
import { parseStoredContract } from "../../common/parse-stored-contract";
import { hasControlChars } from "../../onboarding-discovery/discovery-credentials";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { OnboardingChatService } from "./onboarding-chat.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import { OnboardingCatalogService } from "./onboarding-catalog.service";
import { OnboardingTemplateCatalogService } from "./onboarding-template-catalog.service";
import { OnboardingExcelService } from "./onboarding-excel.service";
import { OnboardingInventoryService } from "./onboarding-inventory.service";
import { looksLikeCredential, scrubMessages } from "./onboarding-credential-detect";
import {
  attachCommitProposal,
  draftHash,
} from "./onboarding-commit-proposal";
import {
  NOTHING_TO_UNDO_REPLY,
  checkpointLabel,
  checkpointSummary,
  cutRingBefore,
  isUndoPhrase,
  nextSeq,
  pushCheckpoint,
  readCheckpoints,
  restoreSections,
  takeCheckpoint,
  undidActionLine,
  undoReply,
  type Checkpoint,
} from "./onboarding-checkpoints";
import { draftCountProblem, draftRecordProblem } from "./onboarding-draft-caps";
import { readDiscovery, withDiscoveryOf } from "./onboarding-discovery-state";
import { applyDiscoveryTurn } from "./onboarding-discovery-tools";
import { diffSections } from "./onboarding-draft-merge";
import { assertPatchLocationTypeIsActive } from "./onboarding-location-type-match";
import type { RollbackBody, SetCredentialsBody } from "./onboarding.schema";
import { keepRedactedValues, redactDraftForClient, rtuSecretKey } from "./onboarding-redaction";
import type { OnboardingDraftInput } from "./onboarding.schema";
import { OnboardingValidateService } from "./onboarding-validate.service";
import {
  DRAFT_CHANGED_SINCE_LOAD,
  DRAFT_TOO_DEEP_FOR_TURN,
  SESSION_NO_LONGER_DRAFT,
  assertSessionStillDraft,
  assertTurnStillBound,
  lockSession,
} from "./onboarding-locked-writes";

export { SESSION_NO_LONGER_DRAFT, DRAFT_CHANGED_DURING_TURN, DRAFT_TOO_DEEP_FOR_TURN } from "./onboarding-locked-writes";

/** `F3.24b` (ADR 0103 Amendment 1, C1): the MQTT CONNECT packet carries the credential, so a control character in it is refused. */
export const MQTT_CREDENTIAL_CONTROL_CHARS = "An MQTT username or password must not contain control characters such as a line break.";

/** `F4.255`: the global administrator's draft list names no organization — it has no home organization to fall back to. */
export const ONBOARDING_DRAFTS_GLOBAL_NEEDS_ORGANIZATION = "A global administrator must name the organization whose drafts to list";
/** `F4.255`: a scoped caller whose account has no home organization names none either. */
export const ONBOARDING_DRAFTS_NO_HOME_ORGANIZATION = "Your account has no home organization; name the organization whose drafts to list";

/**
 * Orchestrates onboarding session lifecycle.
 *
 * `F4.16` / ADR 0043 — `onboarding_sessions` carries `ENABLE ROW LEVEL
 * SECURITY` (migration `0040`). `loadSession`'s initial by-id read runs on
 * `fleetDb`: the organization is not yet known at that point (it comes FROM
 * the row), so there is no id to scope a tenant transaction to until after
 * this read — the role gate runs before it and the organization-scope check
 * immediately afterward (`F4.256`: out of scope answers the missing-id 404). Every write below runs inside
 * `withTenant(tenantDb, session.organizationId, …)` once that id is known.
 * `organizations` carries no policy and stays on `tenantDb` throughout.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly chatService: OnboardingChatService,
    private readonly validateService: OnboardingValidateService,
    private readonly commitService: OnboardingCommitService,
    private readonly excelService: OnboardingExcelService,
    private readonly catalogService: OnboardingCatalogService,
    private readonly vocabularies: VocabulariesService,
    private readonly templateCatalog: OnboardingTemplateCatalogService,
    private readonly inventory: OnboardingInventoryService, // F4.243: validate's parent candidates (ADR 0098 Amendment 2, B4).
  ) {}

  /** Creates a new onboarding session for an organization. */
  async createSession(
    jwt: JwtPayload,
    organizationId: string,
  ): Promise<OnboardingChatResponseDto> {
    await this.assertOnboardingAccess(jwt, organizationId);

    const [org] = await this.tenantDb
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) {
      throw new NotFoundException("Organization not found");
    }

    const opening = this.chatService.openingMessage(org.name);
    const assistantMsg = this.chatService.createMessage("assistant", opening.assistantMessage);
    // F4.255 (ADR 0099 Amendment 2 A1): the draft list says who started a draft. On a request path the guard
    // memoised the identity, so this is no query; `null` when the token names no row.
    const createdBy = await resolveActorId(this.fleetDb, jwt);

    const session = await withTenant(this.tenantDb, organizationId, (tx) =>
      tx
        .insert(onboardingSessions)
        .values({
          organizationId,
          createdBy,
          status: "draft",
          currentPhase: opening.currentPhase,
          draft: {},
          messages: [assistantMsg],
        })
        .returning()
        .then(([row]) => row),
    );

    return {
      assistantMessage: opening.assistantMessage,
      session: this.mapSession(session, org.code, org.name),
      suggestedReplies: opening.suggestedReplies,
      autoOpenPreview: false,
    };
  }

  /**
   * `F4.255` (ADR 0099 Amendment 2 A1) — the organization's open drafts, newest
   * update first, for the copilot dock's resume list. The access is
   * `createSession`'s (`assertOnboardingAccess`) on the organization the caller
   * names, so a scoped administrator naming another organization is a 403 —
   * the id is the caller's own input; `F4.256`'s uniform 404 governs the by-id
   * reads, where the organization comes from the row. The read runs on
   * `fleetDb` as `loadSession`'s does, behind that gate, and **never selects
   * `draft`**: one JSON path takes the location's name, so the draft's
   * `_secrets` never leave the query. The answer is parsed through
   * `onboardingDraftListDtoSchema` on the way out through `parseStoredContract`
   * (ADR 0060 ruling 2), so its `.strict()` runs on the server: an extra key or
   * a stored phase outside the enum is a 500 with no row in it, never a
   * response.
   *
   * With no `organizationId` the list is the caller's **home** organization —
   * the one a scoped administrator's copilot conversation is bound to (`users.organization_id`
   * of the identity `resolveIdentity` resolved, which `requireMasterDataUser`
   * memoised on this payload). The role gate runs first; then the global
   * administrator, who has no home to fall back to, must name one (400), and a
   * caller with no home organization is a 400 too. The home organization then
   * passes the same scope check as a named one.
   */
  async listDrafts(jwt: JwtPayload, requested: string | undefined): Promise<OnboardingDraftListDto> {
    const caller = await this.assertOnboardingRole(jwt);
    let organizationId: string;
    if (requested !== undefined) {
      organizationId = requested;
    } else if (caller.role === "admin") {
      throw new BadRequestException(ONBOARDING_DRAFTS_GLOBAL_NEEDS_ORGANIZATION);
    } else {
      const home = recalledIdentity(jwt)?.organizationId ?? null;
      if (home === null) throw new BadRequestException(ONBOARDING_DRAFTS_NO_HOME_ORGANIZATION);
      organizationId = home;
    }
    await this.assertOnboardingAccess(jwt, organizationId);

    const [org] = await this.tenantDb
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) {
      throw new NotFoundException("Organization not found");
    }

    const rows = await this.fleetDb
      .select({
        id: onboardingSessions.id,
        organizationId: onboardingSessions.organizationId,
        currentPhase: onboardingSessions.currentPhase,
        createdAt: onboardingSessions.createdAt,
        updatedAt: onboardingSessions.updatedAt,
        locationName: sql<string | null>`${onboardingSessions.draft}->'location'->>'name'`,
        createdById: users.id,
        createdByName: users.displayName,
      })
      .from(onboardingSessions)
      .leftJoin(users, eq(users.id, onboardingSessions.createdBy))
      .where(and(eq(onboardingSessions.organizationId, organizationId), eq(onboardingSessions.status, "draft")))
      .orderBy(desc(onboardingSessions.updatedAt))
      .limit(ONBOARDING_DRAFT_LIST_LIMIT);

    return parseStoredContract(
      onboardingDraftListDtoSchema,
      {
        items: rows.map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          currentPhase: row.currentPhase,
          locationName: row.locationName,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          createdBy: row.createdById ? { id: row.createdById, displayName: row.createdByName } : null,
        })),
      },
      "onboarding.list_drafts.dto",
    );
  }

  /** Returns one session with redacted draft. */
  async getSession(jwt: JwtPayload, sessionId: string): Promise<OnboardingSessionDto> {
    // Decision 3's gate now lives in `loadSession` — see the note there.
    const session = await this.loadSession(jwt, sessionId);
    const [org] = await this.tenantDb
      .select({ code: organizations.code, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, session.organizationId))
      .limit(1);
    return this.mapSession(session, org?.code ?? "", org?.name ?? "");
  }

  /**
   * Stores RTU credentials for a draft session (ADR 0022 decision 1).
   *
   * The reason this endpoint exists: credentials used to be typed into the chat
   * and parsed out of the turn, which left plaintext in
   * `onboarding_sessions.messages` and sent it to the LLM. Here the plaintext
   * lives only in the request body, is encrypted through the ADR 0012 path, and
   * is never echoed back — the response is the ordinary redacted session.
   *
   * `F4.233`: the write takes the `FOR UPDATE` and re-checks status and draft
   * hash under it (`assertTurnStillBound`, 409 `DRAFT_CHANGED_DURING_TURN`,
   * nothing written; a commit in between answers 409 `SESSION_NO_LONGER_DRAFT`,
   * and a stored draft deeper than the depth bound has no hash, so it answers
   * 409 `DRAFT_TOO_DEEP_FOR_TURN` and stores nothing). `_secrets` is keyed by the code at `rtuIndex`, so a
   * reorder in between would bind the password to another RTU; the hash
   * refuses it. Merging on `locked.draft` rather than `session.draft` is not
   * gated by design: an equal hash means an equal draft, `_secrets` included.
   */
  async setCredentials(
    jwt: JwtPayload,
    sessionId: string,
    body: SetCredentialsBody,
  ): Promise<OnboardingSessionDto> {
    // `loadSession` applies decision 3's gate — the second call this used to
    // make was a leftover from before Amendment 1 moved it there, and cost a
    // redundant `requireMasterDataUser` round-trip on every write.
    const session = await this.loadSession(jwt, sessionId);
    if (session.status !== "draft") {
      throw new ForbiddenException("Session is not editable");
    }

    const draft = session.draft as OnboardingDraft;
    if (!Array.isArray(draft.rtus) || !draft.rtus[body.rtuIndex]) {
      throw new BadRequestException(`No RTU at index ${body.rtuIndex} in this draft`);
    }
    if (draft.rtus[body.rtuIndex]?.protocol === "mqtt" && Object.values(body.credentials).some(hasControlChars)) {
      throw new BadRequestException(MQTT_CREDENTIAL_CONTROL_CHARS);
    }

    // M4: `_secrets` is keyed by RTU `code`, not by position, so a later
    // reorder cannot hand this password to a different broker. An RTU with no
    // usable code has no identity to bind the credential to — refuse rather
    // than fall back to the index, which is the defect this replaced.
    if (rtuSecretKey(draft, body.rtuIndex) === null) {
      throw new BadRequestException(
        `RTU at index ${body.rtuIndex} has no code, or another RTU in this draft claims the same ` +
          "code. Give each RTU a distinct code before storing credentials.",
      );
    }

    // Fail closed. `mergeDraft`'s existing path sets `credentialsSet: true`
    // without encrypting when the key is missing — the false-success half of
    // `E8.4`. That behaviour is out of scope to change here, but this endpoint
    // must not become a second instance of it: refuse rather than report a
    // success that stored nothing.
    if (!CredentialCryptoService.isConfigured()) {
      throw new ServiceUnavailableException(
        "CREDENTIAL_ENCRYPTION_KEY is not configured, so credentials cannot be stored encrypted. " +
          "Refusing rather than reporting a success that stored nothing.",
      );
    }

    const expectedHash = draftHash(session.draft);
    const updated = await withTenant(this.tenantDb, session.organizationId, async (tx) => {
      // Lock placement is gated by onboarding-chat-lock.integration.test.ts (real Postgres).
      const locked = await lockSession(tx, sessionId);
      assertTurnStillBound(locked, expectedHash);
      const mergedDraft = this.chatService.mergeDraft(locked.draft, {}, {
        rtuIndex: body.rtuIndex,
        credentials: body.credentials,
      });
      const [row] = await tx
        .update(onboardingSessions)
        .set({ draft: mergedDraft, updatedAt: sql`now()` })
        // Defence in depth behind the lock's status check above.
        .where(and(eq(onboardingSessions.id, sessionId), eq(onboardingSessions.status, "draft")))
        .returning();
      return row;
    });
    if (!updated) {
      throw new ConflictException(SESSION_NO_LONGER_DRAFT);
    }

    const [org] = await this.tenantDb
      .select({ code: organizations.code, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, session.organizationId))
      .limit(1);

    return this.mapSession(updated, org?.code ?? "", org?.name ?? "");
  }

  /**
   * Processes a user chat message. Called by the copilot's onboarding skill
   * (`F3.86`); the route that took a typed message is retired (ruling Q5), and
   * no phrase commits: only the commit route or the Confirm card does.
   */
  async chat(
    jwt: JwtPayload,
    sessionId: string,
    message: string,
  ): Promise<OnboardingChatResponseDto> {
    const session = await this.loadSession(jwt, sessionId);
    if (session.status !== "draft") {
      throw new ForbiddenException("Session is not editable");
    }
    // F4.227: taken before any collaborator runs, so nothing downstream can
    // touch the object it hashes. The write re-checks it under `FOR UPDATE`.
    const expectedHash = draftHash(session.draft);

    // ADR 0022 decision 2. Checked before ANY side effect: the turn is not
    // stored in `messages` and never reaches the model (nor the undo
    // match, which runs after this). Returning a
    // normal chat response rather than a 400 keeps the wizard usable — the
    // user is told where the credentials field is instead of hitting an error.
    if (looksLikeCredential(message)) {
      const [orgRefused] = await this.tenantDb
        .select({ code: organizations.code, name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, session.organizationId))
        .limit(1);
      return {
        assistantMessage:
          "That message looks like it contains a credential, so I have not saved it. " +
          "Credentials never go through this chat — use the **Credentials** field on the " +
          "RTU step and they are encrypted before storage (ADR 0012).",
        session: this.mapSession(session, orgRefused?.code ?? "", orgRefused?.name ?? ""),
        suggestedReplies: ["View draft"],
        validationErrors: [],
        readyToCommit: false,
        autoOpenPreview: false,
        autoOpenReason: undefined,
      };
    }

    // F3.25 (ADR 0094 decision 6): the undo phrase is matched by code too —
    // after the ADR 0022 refusal above, before any model call below.
    if (isUndoPhrase(message)) {
      return this.undoLastStep(session, message);
    }

    const draft = session.draft as OnboardingDraft;
    const phase = session.currentPhase as OnboardingPhase;
    const [org] = await this.tenantDb
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, session.organizationId))
      .limit(1);

    const userMsg = this.chatService.createMessage("user", message);
    const turn = await this.chatService.handleTurn(
      message,
      draft,
      phase,
      org?.name ?? "Organization",
      session.organizationId,
      {
        sessionId,
        history: session.messages as OnboardingChatMessage[],
        // F4.111 (ADR 0104 decisions 5 and 6): the early refusal's count, or the exemption.
        pointKeyQuota: await this.templateCatalog.pointKeyQuota(session.organizationId, await this.accessControl.isGlobalAdmin(jwt)),
      },
    );

    // `mergeDraft` clears any stored proposal. A turn that proposed gets a new
    // one, bound to the hash of exactly the draft stored below (decision 5).
    let mergedDraft = this.chatService.mergeDraft(session.draft, turn.draftPatch);
    // F3.24b: the discovery proposal and the credential copies, before the commit hash (a copy changes `_secrets`).
    mergedDraft = applyDiscoveryTurn(mergedDraft, turn, new Date().toISOString());
    if (turn.commitProposal) {
      const hash = draftHash(mergedDraft);
      if (hash !== null) {
        mergedDraft = attachCommitProposal(mergedDraft as object, {
          draftHash: hash,
          summary: turn.commitProposal.summary,
          proposedAt: new Date().toISOString(),
        });
      }
    }

    // `F4.103` — the chat patch builder is the **fourth** draft producer, and
    // the one the first pass of this row missed.
    //
    // `handleRuleBasedTurn` is not a fallback: `.env.example` ships
    // `LLM_PROVIDER=` empty (`F3.21`), so it is the branch that runs by default.
    // Since F3.27 its writes go through `runTool` and its element schemas
    // (`guidedWrite`), whose `add_rtu` and `add_point_key` append to the working
    // draft and refuse a count past a cap in the reply. `mergeDraft` takes
    // `patch.rtus ?? base.rtus`, which replaces the stored array wholesale, so
    // an appended array is stored one longer than the one before it.
    //
    // This check stays as the defence in depth for a draft that is already
    // over a cap. Refused rather than truncated, and refused **before** the write below, so
    // the session is left exactly as it was: draft, phase and message history
    // unchanged. The turn is lost; the session is not. An operator cannot add a
    // 101st RTU by chat, which is the intent.
    //
    // Counted on the **merged** draft, so a session that is somehow already over
    // a cap refuses every turn — the RTU branch appends whatever the message
    // says. `PATCH :id/draft` replaces the arrays wholesale and is the way back
    // out. Below the access gates and below the ADR 0022 credential nudge, both
    // of which answer first on purpose.
    const countProblem = draftCountProblem(mergedDraft as OnboardingDraft);
    if (countProblem !== null) {
      throw new BadRequestException(countProblem);
    }

    // H2 from the 2026-08-10 review: only the *user* turn was inspected. On the
    // agent path `assistantMessage` is model output, so a model echoing back a
    // secret it was handed was stored unchecked. Scrub rather than refuse — the
    // turn is ours, not the user's, so there is nobody to ask to retype it.
    const assistantText = looksLikeCredential(turn.assistantMessage)
      ? "[REDACTED] — the assistant's reply looked like it contained a credential (ADR 0022)"
      : turn.assistantMessage;
    const assistantMsg = this.chatService.createMessage("assistant", assistantText);
    // Decision 6: one code-written `action` message per draft write — and, on
    // the agent path, per refused draft write (F4.135, ADR 0090 Amendment 4) —
    // between the user's turn and the reply.
    // Security review L5: an action line carries model-chosen names, so it takes
    // the same credential scrub as the reply above.
    const actionMsgs = turn.actionLines.map((line) =>
      this.chatService.createMessage(
        "action",
        looksLikeCredential(line) ? "[REDACTED] — an action line looked like it contained a credential (ADR 0022)" : line,
      ),
    );

    // F3.25 (ADR 0094 decision 4): a turn that changes a section records the
    // draft as it was BEFORE the turn, so `undo` can bring it back. A turn that
    // changes nothing leaves the column alone rather than rewriting it.
    const changed =
      Object.keys(diffSections(session.draft as OnboardingDraft, mergedDraft as OnboardingDraft)).length > 0;
    const updated = await withTenant(this.tenantDb, session.organizationId, async (tx) => {
      // Lock placement is gated by onboarding-chat-lock.integration.test.ts (real Postgres): the unit fakes answer `.for()` with a static row.
      const locked = await lockSession(tx, sessionId);
      // F4.227 / F4.230: a commit that landed while the model ran, a stored
      // draft with no hash, a draft that moved — each a 409 with its own sentence.
      assertTurnStillBound(locked, expectedHash);
      // F3.25 / F4.227: the ring is built on the locked row's ring, as `messages`
      // is, so a ring written in between is not overwritten with a stale one.
      let checkpointWrite: { checkpoints: unknown } | Record<string, never> = {};
      if (changed) {
        const ring = readCheckpoints(locked.checkpoints);
        const pushed = pushCheckpoint(
          ring,
          takeCheckpoint(session.draft as OnboardingDraft, {
            seq: nextSeq(ring),
            label: checkpointLabel(
              actionMsgs.map((m) => m.content),
              Object.keys(turn.draftPatch),
            ),
            userMessageId: userMsg.id,
            takenAt: new Date().toISOString(),
          }),
        );
        // Ids and counts only, never content (ADR 0090 decision 9; plan Q2).
        if (pushed.dropped !== "none") {
          this.logger.log(
            { sessionId, dropped: pushed.dropped, ringSize: pushed.ring.length },
            "onboarding checkpoint dropped",
          );
        }
        // Review finding: a snapshot too large to record ends the history, as a
        // PATCH does — otherwise the next undo would revert this step and the
        // one before it together, naming only the older one.
        checkpointWrite = { checkpoints: pushed.dropped === "too_large" ? null : pushed.ring };
      }
      // Built on the locked row: a message written in between (a turn that
      // changed nothing, an empty-ring `undo`) does not change the hash.
      const messages = [
        ...(locked.messages as OnboardingChatMessage[]),
        userMsg,
        ...actionMsgs,
        assistantMsg,
      ];
      const [row] = await tx
        .update(onboardingSessions)
        .set({
          // F3.24b: the worker may have written `_discovery` since the turn read the draft.
          draft: withDiscoveryOf(locked.draft, mergedDraft),
          currentPhase: turn.currentPhase,
          messages,
          ...checkpointWrite,
          updatedAt: sql`now()`,
        })
        // Defence in depth behind the lock's status check above.
        .where(and(eq(onboardingSessions.id, sessionId), eq(onboardingSessions.status, "draft")))
        .returning();
      return row;
    });
    if (!updated) {
      throw new ConflictException(SESSION_NO_LONGER_DRAFT);
    }

    const [orgFull] = await this.tenantDb
      .select({ code: organizations.code, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, session.organizationId))
      .limit(1);

    return {
      assistantMessage: assistantText,
      session: this.mapSession(updated, orgFull?.code ?? "", orgFull?.name ?? ""),
      suggestedReplies: turn.suggestedReplies,
      validationErrors: turn.validationErrors,
      readyToCommit: turn.readyToCommit,
      autoOpenPreview: turn.autoOpenPreview,
      autoOpenReason: turn.autoOpenReason,
    };
  }

  /**
   * Patches the draft from the inline editor. Since `F4.235` it writes under
   * `lockSession` and re-checks the status (409 `SESSION_NO_LONGER_DRAFT` when a
   * commit landed in between); hash-unbound by the `F4.227` ruling; merges on
   * the locked row, so a section written in between survives unless the PATCH
   * names it. The pre-lock 403 stays for a row already committed when loaded.
   * The 409 sentence reads "turn" on a PATCH: chat wording, as on the credential
   * route (`F4.233`).
   */
  async patchDraft(
    jwt: JwtPayload,
    sessionId: string,
    draft: OnboardingDraftInput,
  ): Promise<OnboardingSessionDto> {
    const session = await this.loadSession(jwt, sessionId);
    if (session.status !== "draft") {
      throw new ForbiddenException("Session is not editable");
    }

    // F4.162 (ADR 0077 Amendment 1, plan D9): a type this body names must be an
    // active code — a 400 naming the valid codes. Checked after the session
    // gate, so a caller outside it learns nothing, and only when the body names
    // a type, so a draft whose stored type was retired can still be repaired.
    await assertPatchLocationTypeIsActive(draft, this.vocabularies);
    const locationTypeCodes = await this.activeLocationTypeCodes();
    const placement = { candidates: await this.inventory.listParentCandidates(session.organizationId) };
    const updated = await withTenant(this.tenantDb, session.organizationId, async (tx) => {
      // Lock placement is gated by onboarding-chat-lock.integration.test.ts (real Postgres).
      const locked = await lockSession(tx, sessionId);
      assertSessionStillDraft(locked);
      // F4.185 (review finding): a client sends back the redacted view, so a
      // placeholder under a scrubbed key keeps the stored value, never itself.
      const body = keepRedactedValues(locked.draft, draft);
      // F4.116: the records the body carries, **after** the restore above —
      // a placeholder is 12 bytes in the body and the whole stored secret once
      // restored (review finding). Not the merge: `mergeDraft` replaces a
      // record wholesale, so these are the records stored; and a stored
      // oversized record the body leaves out must not block a PATCH that
      // repairs something else, or the PATCH that shrinks it. The throw rolls
      // the transaction back, so nothing is written.
      const recordProblem = draftRecordProblem(body as OnboardingDraft);
      if (recordProblem !== null) {
        throw new BadRequestException(recordProblem);
      }
      const merged = this.chatService.mergeDraft(locked.draft, body);
      const [row] = await tx
        .update(onboardingSessions)
        .set({
          draft: merged,
          currentPhase: this.validateService.inferPhase(merged, locationTypeCodes, placement),
          // F3.25 (plan Q3): a write the ring did not checkpoint ends undo
          // history, so a later rollback cannot silently undo this edit.
          checkpoints: null,
          updatedAt: sql`now()`,
        })
        // Defence in depth behind the lock's status check above.
        .where(and(eq(onboardingSessions.id, sessionId), eq(onboardingSessions.status, "draft")))
        .returning();
      return row;
    });
    if (!updated) {
      throw new ConflictException(SESSION_NO_LONGER_DRAFT);
    }

    const [org] = await this.tenantDb
      .select({ code: organizations.code, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, session.organizationId))
      .limit(1);

    return this.mapSession(updated, org?.code ?? "", org?.name ?? "");
  }

  /**
   * `POST :id/rollback` (F3.25, ADR 0094 decisions 5 and 6). Bound to the
   * draft hash the client last saw: the row lock orders the writes but cannot
   * tell a stale client, so a client that read the draft before another tab's
   * turn must not restore over it. A mismatch is a 409 and nothing is written.
   */
  async rollback(jwt: JwtPayload, sessionId: string, body: RollbackBody): Promise<OnboardingChatResponseDto> {
    const session = await this.loadSession(jwt, sessionId);
    if (session.status !== "draft") {
      throw new ForbiddenException("Session is not editable");
    }
    if (draftHash(session.draft) !== body.draftHash) {
      throw new ConflictException(DRAFT_CHANGED_SINCE_LOAD);
    }
    const target = readCheckpoints(session.checkpoints).find((cp) => cp.id === body.checkpointId);
    if (!target) {
      throw new NotFoundException("Checkpoint not found");
    }
    return this.restoreTo(session, target);
  }

  /** Validates draft without committing. */
  async validate(jwt: JwtPayload, sessionId: string): Promise<OnboardingValidateResponseDto> {
    const session = await this.loadSession(jwt, sessionId);
    const validation = this.validateService.validate(
      session.draft,
      await this.activeLocationTypeCodes(),
      await this.templateCatalog.context(session.organizationId),
      { candidates: await this.inventory.listParentCandidates(session.organizationId) },
    );
    let autoOpenReason = validation.readyToCommit
      ? ("ready_to_commit" as const)
      : validation.errors.length > 0
        ? ("validation_errors" as const)
        : validation.suggestedPhase === "review"
          ? ("review" as const)
          : undefined;

    return {
      valid: validation.valid,
      errors: validation.errors,
      preview: redactDraftForClient(session.draft),
      readyToCommit: validation.readyToCommit,
      autoOpenPreview: Boolean(autoOpenReason),
      autoOpenReason,
    };
  }

  /** Commits the session through the commit service, only the draft that `expectedDraftHash` names (`F3.86` PR 5; required since the post-closure fix). */
  commit(jwt: JwtPayload, sessionId: string, expectedDraftHash: string) {
    return this.commitService.commitProposed(jwt, sessionId, expectedDraftHash);
  }

  /** Returns an Excel template buffer for bulk onboarding. */
  buildTemplate(_jwt: JwtPayload, _organizationId: string): Buffer {
    return this.excelService.buildTemplateBuffer("Berhampur");
  }

  /**
   * Parses an Excel upload and merges rows into the session draft.
   *
   * `F4.233`: `messages` is built on the locked row and the status is
   * re-checked under the lock (409 `SESSION_NO_LONGER_DRAFT`), so a message
   * committed in between survives. The draft stays hash-unbound (`F4.227`
   * ruling), so a draft change in between is overwritten by this merge.
   */
  async uploadExcel(
    jwt: JwtPayload,
    sessionId: string,
    buffer: Buffer,
  ): Promise<OnboardingChatResponseDto> {
    const session = await this.loadSession(jwt, sessionId);
    if (session.status !== "draft") {
      throw new ForbiddenException("Session is not editable");
    }

    const draft = session.draft as OnboardingDraft;
    // F4.157 / ADR 0077 decision 7: the parser checks the type cell against the
    // live vocabulary, read here so the parser itself stays free of the database.
    const locationTypeCodes = await this.activeLocationTypeCodes();
    const parsed = this.excelService.parseUpload(buffer, locationTypeCodes);
    const orgPointKeys = await this.catalogService.listPointKeys(session.organizationId);
    const useExistingPointKeys = orgPointKeys.length > 0;
    const patch = this.excelService.toDraftPatch(parsed, draft, { useExistingPointKeys });
    const mergedDraft = this.chatService.mergeDraft(
      session.draft,
      patch,
      parsed.rtuCredentials.length > 0 ? parsed.rtuCredentials : undefined,
    ) as OnboardingDraft;
    const placement = { candidates: await this.inventory.listParentCandidates(session.organizationId) };
    const phase = this.validateService.inferPhase(mergedDraft, locationTypeCodes, placement);

    const followUp = this.chatService.excelImportFollowUp(
      mergedDraft,
      {
        locationName: parsed.location.name,
        rtuCount: parsed.rtus.length,
        assetCount: parsed.assets.length,
      },
      orgPointKeys.map((key) => key.code),
      parsed.displayNameFixes,
    );
    const assistantText = followUp.assistantMessage;

    const userMsg = this.chatService.createMessage("user", "[Uploaded Excel workbook]");
    const assistantMsg = this.chatService.createMessage("assistant", assistantText);

    const updated = await withTenant(this.tenantDb, session.organizationId, async (tx) => {
      // Lock placement is gated by onboarding-chat-lock.integration.test.ts (real Postgres).
      const locked = await lockSession(tx, sessionId);
      assertSessionStillDraft(locked);
      const messages = [...(locked.messages as OnboardingChatMessage[]), userMsg, assistantMsg];
      const [row] = await tx
        .update(onboardingSessions)
        .set({
          // F3.24b: as `chat` — keep the `_discovery` the worker wrote since the read.
          draft: withDiscoveryOf(locked.draft, mergedDraft),
          currentPhase: phase,
          messages,
          // F3.25 (plan Q3): as `patchDraft` — an upload is not checkpointed.
          checkpoints: null,
          updatedAt: sql`now()`,
        })
        // Defence in depth behind the lock's status check above.
        .where(and(eq(onboardingSessions.id, sessionId), eq(onboardingSessions.status, "draft")))
        .returning();
      return row;
    });
    if (!updated) {
      throw new ConflictException(SESSION_NO_LONGER_DRAFT);
    }

    const [orgFull] = await this.tenantDb
      .select({ code: organizations.code, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, session.organizationId))
      .limit(1);

    const validation = this.validateService.validate(
      mergedDraft,
      locationTypeCodes,
      await this.templateCatalog.context(session.organizationId),
      placement,
    );

    return {
      assistantMessage: assistantText,
      session: this.mapSession(updated, orgFull?.code ?? "", orgFull?.name ?? ""),
      suggestedReplies: followUp.suggestedReplies,
      validationErrors: validation.errors,
      readyToCommit: validation.readyToCommit,
      autoOpenPreview: true,
      autoOpenReason: validation.errors.length > 0 ? "validation_errors" : "review",
    };
  }

  /** The active `bms.location_types` codes, which the validator takes (F4.162, plan D9). */
  private async activeLocationTypeCodes(): Promise<string[]> {
    return (await this.vocabularies.listLocationTypes()).map((row) => row.code);
  }

  /**
   * ADR 0022 Amendment 1 (2026-08-10 security review). The role check lives
   * HERE, not on individual routes, because the first pass raised only
   * `getSession` and left `chat`, `patchDraft`, `uploadExcel` and `validate` on
   * the weaker org-scope check — inverting the ADR's own principle by making
   * the writes weaker than the read they expose. `uploadExcel` is the sharp
   * case: it writes credentials parsed from the workbook, so a `location_admin`
   * refused by `POST :id/credentials` could still write credentials via Excel.
   *
   * `F4.256` (AGENTS.md §4.7, the F4.64 rule): the role gate runs before the
   * read, so its 403 does not depend on whether the id exists, and a session
   * outside the caller's organization scope is the same 404 as a missing one.
   *
   * Public since `F3.24b`: `OnboardingDiscoveryService` runs the same gate
   * before it writes any refuse row (security review M5).
   */
  async loadSession(jwt: JwtPayload, sessionId: string) {
    await this.assertOnboardingRole(jwt);
    const [session] = await this.fleetDb
      .select()
      .from(onboardingSessions)
      .where(eq(onboardingSessions.id, sessionId))
      .limit(1);
    if (!session || !(await this.accessControl.canManageOrganization(jwt, session.organizationId))) {
      throw new NotFoundException("Onboarding session not found");
    }
    return session;
  }

  /** `createSession`'s gate: the caller names the organization, so out of scope is a 403 there. */
  private async assertOnboardingAccess(jwt: JwtPayload, organizationId: string) {
    await this.assertOnboardingRole(jwt);
    if (!(await this.accessControl.canManageOrganization(jwt, organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
  }

  private async assertOnboardingRole(jwt: JwtPayload) {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role !== "admin" && user.role !== "organization_admin") {
      throw new ForbiddenException("Onboarding requires admin or organization_admin role");
    }
    return user;
  }

  /**
   * The chat `undo` (ADR 0094 decision 6): the newest checkpoint, or — with an
   * empty ring — the two messages and nothing else. `F4.231`: the empty-ring
   * write takes the same `FOR UPDATE` and the same re-checks as `chat`, and
   * builds `messages` on the locked row. A ring that appeared in between came
   * with a draft change, so the hash re-check answers 409 rather than a stale
   * "nothing to undo".
   */
  private async undoLastStep(
    session: typeof onboardingSessions.$inferSelect,
    message: string,
  ): Promise<OnboardingChatResponseDto> {
    const newest = readCheckpoints(session.checkpoints).at(-1);
    if (newest) {
      return this.restoreTo(session, newest, message);
    }
    const expectedHash = draftHash(session.draft);
    const updated = await withTenant(this.tenantDb, session.organizationId, async (tx) => {
      // Lock placement is gated by onboarding-chat-lock.integration.test.ts (real Postgres).
      const locked = await lockSession(tx, session.id);
      assertTurnStillBound(locked, expectedHash);
      const messages = [
        ...(locked.messages as OnboardingChatMessage[]),
        this.chatService.createMessage("user", message),
        this.chatService.createMessage("assistant", NOTHING_TO_UNDO_REPLY),
      ];
      const [row] = await tx
        .update(onboardingSessions)
        .set({ messages, updatedAt: sql`now()` })
        // Defence in depth behind the lock's status check above.
        .where(and(eq(onboardingSessions.id, session.id), eq(onboardingSessions.status, "draft")))
        .returning();
      return row;
    });
    if (!updated) {
      throw new ConflictException(SESSION_NO_LONGER_DRAFT);
    }
    return {
      assistantMessage: NOTHING_TO_UNDO_REPLY,
      session: await this.mapSessionWithOrg(updated),
      suggestedReplies: ["View draft"],
      validationErrors: [],
      readyToCommit: false,
      autoOpenPreview: false,
    };
  }

  /**
   * Restores `cp` wholesale (ADR 0094 decision 5): the proposal goes, the phase
   * is re-derived, and the ring is cut to the entries before `cp` — a rollback
   * records no checkpoint, so there is no redo (plan Q4). `userMessage` is the
   * chat `undo`; the route adds no user message.
   */
  private async restoreTo(
    session: typeof onboardingSessions.$inferSelect,
    cp: Checkpoint,
    userMessage?: string,
  ): Promise<OnboardingChatResponseDto> {
    const codes = await this.activeLocationTypeCodes();
    const templateContext = await this.templateCatalog.context(session.organizationId);
    const placement = { candidates: await this.inventory.listParentCandidates(session.organizationId) };
    const deriveCredentialsSet = CredentialCryptoService.isConfigured();
    const expectedHash = draftHash(session.draft);
    // Review finding (F3.25): the hash check and the write are one locked
    // step, as `commitProposed` does it. `chat` takes the same lock and the
    // same check since `F4.227`; a turn or a commit that landed after
    // `loadSession` read the row is seen here, and the restore is built from
    // the row as it now stands.
    const { updated, draft, reply } = await withTenant(this.tenantDb, session.organizationId, async (tx) => {
      const locked = await lockSession(tx, session.id);
      if (!locked || locked.status !== "draft") {
        throw new ForbiddenException("Session is not editable");
      }
      // F4.230: two over-deep drafts both hash to `null`, so the comparison
      // below would pass. Reachable by the chat `undo` only: the route's
      // `draftHash` is 64 hex, never `null`.
      if (expectedHash === null) {
        throw new ConflictException(DRAFT_TOO_DEEP_FOR_TURN);
      }
      const ring = readCheckpoints(locked.checkpoints);
      const target = ring.find((entry) => entry.id === cp.id);
      if (draftHash(locked.draft) !== expectedHash || !target) {
        throw new ConflictException(DRAFT_CHANGED_SINCE_LOAD);
      }
      const restored = restoreSections(locked.draft as OnboardingDraft, target, { deriveCredentialsSet });
      const answer = undoReply(target.label, restored.credentialsLost);
      const messages = [
        ...(locked.messages as OnboardingChatMessage[]),
        ...(userMessage === undefined ? [] : [this.chatService.createMessage("user", userMessage)]),
        this.chatService.createMessage("action", undidActionLine(target.label)),
        this.chatService.createMessage("assistant", answer),
      ];
      const [row] = await tx
        .update(onboardingSessions)
        .set({
          draft: restored.draft,
          currentPhase: this.validateService.inferPhase(restored.draft, codes, placement),
          messages,
          checkpoints: cutRingBefore(ring, target),
          updatedAt: sql`now()`,
        })
        .where(eq(onboardingSessions.id, session.id))
        .returning();
      return { updated: row, draft: restored.draft, reply: answer };
    });
    const validation = this.validateService.validate(draft, codes, templateContext, placement);
    return {
      assistantMessage: reply,
      session: await this.mapSessionWithOrg(updated),
      suggestedReplies: ["View draft"],
      validationErrors: validation.errors,
      readyToCommit: validation.readyToCommit,
      autoOpenPreview: false,
    };
  }

  private async mapSessionWithOrg(row: typeof onboardingSessions.$inferSelect): Promise<OnboardingSessionDto> {
    const [org] = await this.tenantDb
      .select({ code: organizations.code, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, row.organizationId))
      .limit(1);
    return this.mapSession(row, org?.code ?? "", org?.name ?? "");
  }

  private mapSession(
    row: typeof onboardingSessions.$inferSelect,
    organizationCode: string,
    organizationName: string,
  ): OnboardingSessionDto {
    return {
      id: row.id,
      organizationId: row.organizationId,
      organizationCode,
      organizationName,
      status: row.status as OnboardingSessionDto["status"],
      currentPhase: row.currentPhase as OnboardingPhase,
      draft: redactDraftForClient(row.draft),
      // ADR 0022 decision 4 — defence in depth. Decision 2 is what keeps
      // secrets out of storage; this bounds the damage if it ever fails.
      messages: scrubMessages(row.messages),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      committedAt: row.committedAt?.toISOString() ?? null,
      result: (row.result as Record<string, unknown>) ?? null,
      // F3.25 (ADR 0094 decision 7): summaries only — never the sections — and
      // the hash a rollback binds to.
      checkpoints: readCheckpoints(row.checkpoints).map(checkpointSummary),
      draftHash: draftHash(row.draft),
      // F3.24b (ADR 0103): the worker's result; `redactDraftForClient` removes the raw key.
      discovery: readDiscovery(row.draft),
    };
  }
}
