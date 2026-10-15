import type { CopilotFillStepDto, CopilotPendingChangeDto, JwtPayload } from "@bms/shared";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { defineToolRegistry, type ToolRegistry } from "../llm/tool-registry";

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

/** The Nest token the turn service injects its read tools by. */
export const COPILOT_READ_TOOLS = Symbol("COPILOT_READ_TOOLS");

/** No tools: every call the model makes is an unknown name. For specs that need none; `CopilotModule` binds `CopilotReadToolSet`. */
export const EMPTY_COPILOT_READ_TOOLS: CopilotReadTools & {
  readonly registryWithoutAccess: CopilotReadTools["registry"];
  registryFor(options: { readonly access: boolean; readonly role: string }): CopilotReadTools["registry"];
} = {
  registry: defineToolRegistry<string>({}, {}),
  // `F3.86` PR 4: also an empty propose tool set, which has the second registry (and, `F3.87` PR 2, one per role).
  registryWithoutAccess: defineToolRegistry<string>({}, {}),
  registryFor: () => defineToolRegistry<string>({}, {}),
  dispatch: async () => ({ ok: false, error: "No such tool." }),
};
