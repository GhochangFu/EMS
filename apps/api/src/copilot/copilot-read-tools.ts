import type { CopilotFillStepDto, CopilotPendingChangeDto, JwtPayload } from "@bms/shared";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { defineToolRegistry, type ToolRegistry } from "../llm/tool-registry";
import type { TurnAttachment } from "./copilot-attachments";
import type { CopilotOpenWizardRecord } from "./copilot-open-wizards";

/**
 * `F3.85` PR 7 / ADR 0099 decisions 1, 9, 10 — the seam between the turn
 * service and the copilot's read tools.
 *
 * **What a tool set owns:** its registry (`defineToolRegistry`: names, Zod
 * argument schemas, descriptions) and `dispatch`, which runs one call whose
 * arguments the registry has already parsed. A tool resolves the organization
 * of every resource it is named by id with the user's own read scope, refuses
 * one outside `ctx.allowedOrganizationIds`, calls the service, parses the
 * result through its shared contract schema and reports the organizations it
 * read.
 *
 * **What the turn service owns, so no tool can forget it:** `runToolCall` with
 * the two argument guards (the withheld-value marker and the credential walk
 * over every argument), the secret scrub over every string of a successful
 * result before `toolResultContent`, the check that every reported
 * organization is in the allowed set (a tool that reports another fails
 * closed), the turn's `organization_ids` provenance, and the `navigateTo`
 * shape check.
 */

/** What one tool call may use. Built per turn; the organization always comes from the conversation row. */
export interface CopilotToolContext {
  /** The caller's database identity (`CopilotAccessGuard`). */
  readonly identity: ResolvedIdentity;
  /** The caller's token, for the services that take one (`LocationsAdminService`, `DashboardsService`, `AccessControlService`). */
  readonly user: JwtPayload;
  readonly conversationId: string;
  /** The conversation's bound organization, `null` for a cross-organization conversation. */
  readonly conversationOrganizationId: string | null;
  /**
   * Decision 10: the organizations whose data this turn's key may be sent.
   * `[orgId]` for a bound conversation; the platform scope otherwise (it may be
   * empty). A tool never reads outside it, and never makes a fleet-wide read.
   */
  readonly allowedOrganizationIds: readonly string[];
  /** `follow_up` is an automatic turn after a Confirm (PR 8); a release-2 access tool refuses on it. */
  readonly turnKind: "user" | "follow_up";
  /**
   * `F3.86` PR 4, ruling Q3: the user's own message in this turn asks for an
   * access change (`accessIntentOf`), decided before any tool ran. Absent is
   * `false`: an access propose tool refuses.
   */
  readonly accessIntent?: boolean;
  /**
   * `F3.87` PR 7 (ADR 0099 Amendment 3 A4): the files this user turn carries,
   * inspected. A propose step reads an attached `.svg` from here; nothing
   * stores them. Absent on a turn without files.
   */
  readonly attachments?: readonly TurnAttachment[];
  /**
   * `F3.87` PR 7, plan D8: `false` when the turn carries a file and the user's
   * own message names no asset word — the asset and point creates then refuse.
   * Absent is `true`.
   */
  readonly assetIntent?: boolean;
  /**
   * `F3.87` PR 7, plan D11: a file was attached in this conversation after its
   * last layout proposal, so a layout card says it was read from a file.
   */
  readonly historyHasAttachmentSinceLastLayout?: boolean;
  /**
   * `F4.245` (ADR 0099 Amendment 4): the wizards open on the user's screen,
   * each resolved inside this turn's scope; a record outside it is not here.
   * `fill_step` fills only one of these. Absent is none open: a fill is refused.
   */
  readonly openWizards?: readonly CopilotOpenWizardRecord[];
  /**
   * `F4.245`: the wizards of the pages an `open_page` call of this turn opened,
   * resolved the same way; the turn service appends as the calls run. A fill
   * for one of these waits in the browser for that wizard. Absent is none.
   */
  readonly pageWizards?: CopilotOpenWizardRecord[];
  readonly now: Date;
}

/** One tool call's answer, before the turn service scrubs it. */
export type CopilotToolResult =
  | {
      readonly ok: true;
      /** The contract DTO (or a list of them), already parsed through its shared schema. */
      readonly result: Record<string, unknown>;
      /** Every organization whose data `result` holds. Each must be in the allowed set. */
      readonly organizationIds: readonly string[];
      /** `open_page` only: an app route from the allow-list, for the dock's router. */
      readonly navigateTo?: string;
      /** A propose tool only (`F3.85` PR 8): the change it stored, for the Confirm card. */
      readonly pendingChange?: CopilotPendingChangeDto;
      /** `fill_step` only (`F3.85` PR 8): the values for an open wizard step. */
      readonly fillStep?: CopilotFillStepDto;
    }
  | { readonly ok: false; readonly error: string };

export interface CopilotReadTools {
  readonly registry: ToolRegistry<string>;
  /** Called only with a registry name and schema-parsed arguments. A throw becomes a generic `fail`. */
  dispatch(name: string, args: Record<string, unknown>, ctx: CopilotToolContext): Promise<CopilotToolResult>;
}

/**
 * Which propose registry a turn gets (`F3.86` ruling Q3, `F3.87` Amendment 3
 * A1 and plan D8): with or without the access entries, the entries offered to
 * the caller's role, and with or without the asset and point creates (absent
 * is `true`).
 */
export type RegistryOptions = { readonly access: boolean; readonly role: string; readonly assetCreate?: boolean };

/** The Nest token the turn service injects its read tools by. */
export const COPILOT_READ_TOOLS = Symbol("COPILOT_READ_TOOLS");

/** No tools: every call the model makes is an unknown name. For specs that need none; `CopilotModule` binds `CopilotReadToolSet`. */
export const EMPTY_COPILOT_READ_TOOLS: CopilotReadTools & {
  readonly registryWithoutAccess: CopilotReadTools["registry"];
  registryFor(options: RegistryOptions): CopilotReadTools["registry"];
  openWizardRecords(): Promise<CopilotOpenWizardRecord[]>;
  pageWizardRecords(): Promise<CopilotOpenWizardRecord[]>;
} = {
  registry: defineToolRegistry<string>({}, {}),
  // `F3.86` PR 4: also an empty propose tool set, which has the second registry (and, `F3.87` PR 2, one per role).
  registryWithoutAccess: defineToolRegistry<string>({}, {}),
  registryFor: () => defineToolRegistry<string>({}, {}),
  // `F4.245`: no propose tools, so no wizard is open to a fill.
  openWizardRecords: async () => [],
  pageWizardRecords: async () => [],
  dispatch: async () => ({ ok: false, error: "No such tool." }),
};
