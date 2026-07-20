import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
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
import { DRIZZLE } from "../../database/database.tokens";
import { OnboardingChatService } from "./onboarding-chat.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import { OnboardingCatalogService } from "./onboarding-catalog.service";
import { OnboardingExcelService } from "./onboarding-excel.service";
import { redactDraftForClient } from "./onboarding-redaction";
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
    const session = await this.loadSession(jwt, sessionId);
    const [org] = await this.db
      .select({ code: organizations.code, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, session.organizationId))
      .limit(1);
    return this.mapSession(session, org?.code ?? "", org?.name ?? "");
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

    const mergedDraft = this.chatService.mergeDraft(
      session.draft,
      turn.draftPatch,
      turn.credentialsToEncrypt,
    );

    const assistantMsg = this.chatService.createMessage("assistant", turn.assistantMessage);
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
      assistantMessage: turn.assistantMessage,
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
    if (!(await this.accessControl.canManageOrganization(jwt, session.organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
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
      messages: (row.messages as OnboardingChatMessage[]) ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      committedAt: row.committedAt?.toISOString() ?? null,
      result: (row.result as Record<string, unknown>) ?? null,
    };
  }
}
