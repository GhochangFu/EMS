import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { eq, sql } from "drizzle-orm";

import { onboardingSessions, organizations } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  OnboardingChatMessage,
  OnboardingChatResponseDto,
  OnboardingDraft,
  OnboardingPhase,
  OnboardingSessionDto,
  OnboardingValidateResponseDto,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { DRIZZLE } from "../../database/database.tokens";
import { OnboardingChatService } from "./onboarding-chat.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import { OnboardingCatalogService } from "./onboarding-catalog.service";
import { OnboardingExcelService } from "./onboarding-excel.service";
import { looksLikeCredential, scrubMessages } from "./onboarding-credential-detect";
import type { SetCredentialsBody } from "./onboarding.schema";
import { redactDraftForClient, rtuSecretKey } from "./onboarding-redaction";
import type { OnboardingDraftInput } from "./onboarding.schema";
import { OnboardingValidateService } from "./onboarding-validate.service";

/** Orchestrates onboarding session lifecycle. */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly chatService: OnboardingChatService,
    private readonly validateService: OnboardingValidateService,
    private readonly commitService: OnboardingCommitService,
    private readonly excelService: OnboardingExcelService,
    private readonly catalogService: OnboardingCatalogService,
  ) {}

  /** Creates a new onboarding session for an organization. */
  async createSession(
    jwt: JwtPayload,
    organizationId: string,
  ): Promise<OnboardingChatResponseDto> {
    await this.assertOnboardingAccess(jwt, organizationId);

    const [org] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) {
      throw new NotFoundException("Organization not found");
    }

    const opening = this.chatService.openingMessage(org.name);
    const assistantMsg = this.chatService.createMessage("assistant", opening.assistantMessage);

    const [session] = await this.db
      .insert(onboardingSessions)
      .values({
        organizationId,
        status: "draft",
        currentPhase: opening.currentPhase,
        draft: {},
        messages: [assistantMsg],
      })
      .returning();

    return {
      assistantMessage: opening.assistantMessage,
      session: this.mapSession(session, org.code, org.name),
      suggestedReplies: opening.suggestedReplies,
      autoOpenPreview: false,
    };
  }

  /** Returns one session with redacted draft. */
  async getSession(jwt: JwtPayload, sessionId: string): Promise<OnboardingSessionDto> {
    // Decision 3's gate now lives in `loadSession` — see the note there.
    const session = await this.loadSession(jwt, sessionId);
    const [org] = await this.db
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

    const mergedDraft = this.chatService.mergeDraft(session.draft, {}, {
      rtuIndex: body.rtuIndex,
      credentials: body.credentials,
    });

    const [updated] = await this.db
      .update(onboardingSessions)
      .set({ draft: mergedDraft, updatedAt: sql`now()` })
      .where(eq(onboardingSessions.id, sessionId))
      .returning();

    const [org] = await this.db
      .select({ code: organizations.code, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, session.organizationId))
      .limit(1);

    return this.mapSession(updated, org?.code ?? "", org?.name ?? "");
  }

  /** Processes a user chat message. */
  async chat(
    jwt: JwtPayload,
    sessionId: string,
    message: string,
  ): Promise<OnboardingChatResponseDto> {
    const session = await this.loadSession(jwt, sessionId);
    if (session.status !== "draft") {
      throw new ForbiddenException("Session is not editable");
    }

    // ADR 0022 decision 2. Checked before ANY side effect: the turn is not
    // stored in `messages` and never reaches `handleOpenAiTurn`. Returning a
    // normal chat response rather than a 400 keeps the wizard usable — the
    // user is told where the credentials field is instead of hitting an error.
    if (looksLikeCredential(message)) {
      const [orgRefused] = await this.db
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
        suggestedReplies: ["View draft", "Add point key kw"],
        validationErrors: [],
        readyToCommit: false,
        autoOpenPreview: false,
        autoOpenReason: undefined,
      };
    }

    const draft = session.draft as OnboardingDraft;
    const phase = session.currentPhase as OnboardingPhase;
    const [org] = await this.db
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
    );

    const mergedDraft = this.chatService.mergeDraft(session.draft, turn.draftPatch);

    // H2 from the 2026-08-10 review: only the *user* turn was inspected. On the
    // OpenAI path `assistantMessage` is model output, so a model echoing back a
    // secret it was handed was stored unchecked. Scrub rather than refuse — the
    // turn is ours, not the user's, so there is nobody to ask to retype it.
    const assistantText = looksLikeCredential(turn.assistantMessage)
      ? "[REDACTED] — the assistant's reply looked like it contained a credential (ADR 0022)"
      : turn.assistantMessage;
    const assistantMsg = this.chatService.createMessage("assistant", assistantText);
    const messages = [
      ...(session.messages as OnboardingChatMessage[]),
      userMsg,
      assistantMsg,
    ];

    const [updated] = await this.db
      .update(onboardingSessions)
      .set({
        draft: mergedDraft,
        currentPhase: turn.currentPhase,
        messages,
        updatedAt: sql`now()`,
      })
      .where(eq(onboardingSessions.id, sessionId))
      .returning();

    const [orgFull] = await this.db
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

  /** Patches draft from inline editor. */
  async patchDraft(
    jwt: JwtPayload,
    sessionId: string,
    draft: OnboardingDraftInput,
  ): Promise<OnboardingSessionDto> {
    const session = await this.loadSession(jwt, sessionId);
    if (session.status !== "draft") {
      throw new ForbiddenException("Session is not editable");
    }

    const merged = this.chatService.mergeDraft(session.draft, draft);
    const phase = this.validateService.inferPhase(merged);

    const [updated] = await this.db
      .update(onboardingSessions)
      .set({
        draft: merged,
        currentPhase: phase,
        updatedAt: sql`now()`,
      })
      .where(eq(onboardingSessions.id, sessionId))
      .returning();

    const [org] = await this.db
      .select({ code: organizations.code, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, session.organizationId))
      .limit(1);

    return this.mapSession(updated, org?.code ?? "", org?.name ?? "");
  }

  /** Validates draft without committing. */
  async validate(jwt: JwtPayload, sessionId: string): Promise<OnboardingValidateResponseDto> {
    const session = await this.loadSession(jwt, sessionId);
    const validation = this.validateService.validate(session.draft);
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

  /** Commits session via commit service. */
  commit(jwt: JwtPayload, sessionId: string) {
    return this.commitService.commit(jwt, sessionId);
  }

  /** Returns an Excel template buffer for bulk onboarding. */
  buildTemplate(_jwt: JwtPayload, _organizationId: string): Buffer {
    return this.excelService.buildTemplateBuffer("Berhampur");
  }

  /** Parses an Excel upload and merges rows into the session draft. */
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
    const parsed = this.excelService.parseUpload(buffer);
    const orgPointKeys = await this.catalogService.listPointKeys(session.organizationId);
    const useExistingPointKeys = orgPointKeys.length > 0;
    const patch = this.excelService.toDraftPatch(parsed, draft, { useExistingPointKeys });
    const mergedDraft = this.chatService.mergeDraft(
      session.draft,
      patch,
      parsed.rtuCredentials.length > 0 ? parsed.rtuCredentials : undefined,
    ) as OnboardingDraft;
    const phase = this.validateService.inferPhase(mergedDraft);

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
    const messages = [
      ...(session.messages as OnboardingChatMessage[]),
      userMsg,
      assistantMsg,
    ];

    const [updated] = await this.db
      .update(onboardingSessions)
      .set({
        draft: mergedDraft,
        currentPhase: phase,
        messages,
        updatedAt: sql`now()`,
      })
      .where(eq(onboardingSessions.id, sessionId))
      .returning();

    const [orgFull] = await this.db
      .select({ code: organizations.code, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, session.organizationId))
      .limit(1);

    const validation = this.validateService.validate(mergedDraft);

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

  /**
   * ADR 0022 Amendment 1 (2026-08-10 security review). The role check lives
   * HERE, not on individual routes, because the first pass raised only
   * `getSession` and left `chat`, `patchDraft`, `uploadExcel` and `validate` on
   * the weaker org-scope check — inverting the ADR's own principle by making
   * the writes weaker than the read they expose. `uploadExcel` is the sharp
   * case: it writes credentials parsed from the workbook, so a `location_admin`
   * refused by `POST :id/credentials` could still write credentials via Excel.
   */
  private async loadSession(jwt: JwtPayload, sessionId: string) {
    await this.accessControl.requireMasterDataUser(jwt);
    const [session] = await this.db
      .select()
      .from(onboardingSessions)
      .where(eq(onboardingSessions.id, sessionId))
      .limit(1);
    if (!session) {
      throw new NotFoundException("Onboarding session not found");
    }
    await this.assertOnboardingAccess(jwt, session.organizationId);
    return session;
  }

  private async assertOnboardingAccess(jwt: JwtPayload, organizationId: string) {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role !== "admin" && user.role !== "organization_admin") {
      throw new ForbiddenException("Onboarding requires admin or organization_admin role");
    }
    if (!(await this.accessControl.canManageOrganization(jwt, organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
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
    };
  }
}
