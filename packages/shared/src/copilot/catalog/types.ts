import type { z, ZodTypeAny } from "zod";
import type { userRoleSchema } from "../../contracts/auth";

type UserRole = z.infer<typeof userRoleSchema>;

/**
 * `F3.85` PR 8 / ADR 0099 decisions 2, 3, 4 and 6 — the shape of one action
 * catalog entry: one API write route the copilot may propose and a wizard may
 * submit.
 *
 * The catalog is data. It holds no database access: the target's organization
 * and name are resolved on the server from the declarative `target` and `refs`
 * below (`apps/api/src/copilot/copilot-target-resolver.ts`), and the summary
 * is a pure function of what the server resolved.
 */

/** How much a change can do; the Confirm card styles it, and `copilot_pending_changes_risk_check` holds the same four. */
export type CatalogRisk = "create" | "edit" | "deactivate" | "access";

/**
 * `F3.86` PR 2: `DELETE` is a method a catalog entry may have, but only the
 * two removals of ADR 0099 decision 3 (ruling 19) are allowed one — the rule
 * is in the gates (`DELETE_ALLOWANCE`, `catalog.spec.ts`,
 * `tests/f3.85-catalog-coverage`), not in this type.
 */
export type CatalogMethod = "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Where a change's organization comes from. Every target row is
 * `organization_id NOT NULL`, so a change always has one organization.
 *
 * - `organization`: the body's `organizationId` (a create); `manage` names
 *   the route's own authority check for it (a dashboard checks its body
 *   scope, a template the organization, a parameter its body scope);
 * - `dashboard`, `dashboardTemplate`, `calcParameter`, `assetTemplate`: the
 *   row the path parameter `id` names (`assetTemplate` since `F3.85` PR 11a;
 *   the resolver also reads its stored content and point keys);
 * - `asset`: the asset the path parameter `assetId` (or `id`) names.
 *
 * `F3.86` PR 2 (release 2):
 *
 * - `organization` with `manage: "location"`: a location create, the body's
 *   `organizationId`;
 * - `location`, `rtu`, `assetGroup`, `assetGroupMember`, `assetPoint`: the
 *   row the path parameter names;
 * - `pointKey`: a point-key row (no organization); like `fleet`, the change
 *   lives in the conversation's bound organization;
 * - `parent`: a create whose organization is the row a body field names (an
 *   RTU, asset or asset group create names its `locationId`; an asset-point
 *   create its `assetId`), with the route's own manage check on that row;
 * - `fleet`: a row with no organization (the point-key catalog); the change
 *   lives in the conversation's bound organization, and a conversation bound
 *   to none is refused (ruling Q1);
 * - `siteControlRoomView`, `siteLayout`: the location the path parameter
 *   names, with the two Control Room routes' own checks (ruling Q7(b)).
 *
 * `F3.86` PR 4 (`risk: "access"`, ADR 0089's checks called through
 * `UsersService` and `UserGrantsService`):
 *
 * - `organization` with `manage: "user"`: a user create, the body's
 *   `organizationId`;
 * - `user`: the user the path parameter names, in the user's home
 *   organization (a global admin is never a target);
 * - `userGrantAdd`: the user the path names, in the organization of the
 *   grant target the body names (the audit row's);
 * - `userGrant`: one grant of the user `userParam` names, by `param` and
 *   `kindParam`, in its target's organization.
 *
 * `F3.86` PR 6 (decision 7):
 *
 * - `onboardingSession`: the onboarding session the path parameter names.
 *   Only a `proposer: "server"` entry has it (the onboarding commit): the
 *   copilot makes that change after a skill turn the onboarding service
 *   answered, so the resolver never resolves it and refuses it if asked.
 *
 * `F4.254` PR 3:
 *
 * - `assetTemplateDeploy`: the template the path parameter `id` names, with
 *   the instantiate route's **deploy** authority (ADR 0015 §7,
 *   `asset-templates-instantiate-core.ts`): `canManageOrganization` on the
 *   template's organization, then `canManageLocation` on the target site — the
 *   body's `locationId`, or the site of its `rtuId`. That admits a
 *   `location_admin` on a site it manages, which the authoring check
 *   `assetTemplate` mirrors (`canManageTemplate`) never does.
 *
 * `F3.87` PR 2 (ADR 0099 Amendment 3 A1):
 *
 * - `organization` with `manage: "mimic"`: a layout or library create, or a
 *   built-in library setting — the body's `organizationId`, with the mimic
 *   services' authoring check (`AUTHOR_ROLES`, then `canManageOrganization`);
 * - `mimicLayout`, `mimicLibrary`: the layout or organization library row
 *   the path parameter `id` names, with the same authoring check
 *   (`mimicSymbol.update` names its library row; the route validates
 *   `symbolId`).
 */
export type CatalogTarget =
  | {
      readonly kind: "organization";
      readonly manage: "dashboard" | "template" | "calcParameter" | "location" | "user" | "mimic";
    }
  | { readonly kind: "mimicLayout" | "mimicLibrary"; readonly param: "id" }
  | { readonly kind: "dashboard" | "dashboardTemplate" | "calcParameter" | "assetTemplate"; readonly param: "id" }
  | { readonly kind: "asset"; readonly param: "assetId" | "id" }
  | {
      readonly kind:
        | "location"
        | "rtu"
        | "assetGroup"
        | "assetGroupMember"
        | "assetPoint"
        | "pointKey"
        | "siteControlRoomView"
        | "siteLayout";
      readonly param: string;
    }
  | { readonly kind: "parent"; readonly field: "locationId" | "assetId"; readonly of: "location" | "asset" }
  | { readonly kind: "fleet" }
  | { readonly kind: "onboardingSession"; readonly param: "id" }
  | { readonly kind: "assetTemplateDeploy"; readonly param: "id" }
  | { readonly kind: "user" | "userGrantAdd"; readonly param: "id" }
  | { readonly kind: "userGrant"; readonly param: "grantId"; readonly kindParam: "kind"; readonly userParam: "id" };

/** The row kinds a body field may hold the id of. */
export type CatalogRefKind = "location" | "assetGroup" | "asset" | "rtu" | "organization" | "dashboard" | "dashboardTemplate";

/**
 * A body field holding the id of a row that must belong to the change's
 * organization; or, for a field whose row kind depends on another field (a
 * grant's `targetId` and its `kind`), the map from that field's value to a
 * row kind. A value the map does not name is refused.
 */
export type CatalogRef =
  | { readonly field: string; readonly kind: CatalogRefKind }
  | { readonly field: string; readonly kindField: string; readonly kinds: Readonly<Record<string, CatalogRefKind>> };

/**
 * A body field holding a formula, and the field holding its dialect.
 *
 * Each is a path: keys joined by `.`, and `[]` after a key for every item of
 * that array (`points[].formula`, `content.kpis[].expression`). The dialect
 * sits in the same item as its formula (`formulaSitesOf`).
 */
export type CatalogFormula = {
  readonly field: string;
  readonly dialectField: string;
  /**
   * Where the point keys the formula may name come from: every string at this
   * path across the body (`points[].pointKey`). Absent, or a body that does
   * not carry the path: the target's point keys (`formulaRefsOf`).
   */
  readonly refsField?: string;
};

/** One wizard step: the top-level body fields it edits. The Review step is not listed; every wizard ends with it. */
export type CatalogStep = { readonly id: string; readonly title: string; readonly fields: readonly string[] };

/** What the server resolved for one proposal; the summary reads only this. */
export type CatalogSummaryInput = {
  /** The body as the model sent it, after it passed `body`. */
  readonly body: Readonly<Record<string, unknown>>;
  readonly params: Readonly<Record<string, string>>;
  /** The target row's name (a dashboard, a template, a parameter key, an asset), or the organization's name for a create. */
  readonly targetName: string;
  readonly organizationName: string;
  /** `dashboard.widgets.replace` only: the ids of the dashboard's widgets now (decision 4.9). */
  readonly currentWidgetIds?: readonly string[];
  /** `F3.86` PR 4: the name of the row a change names beside its target (a grant's organization, site or group). */
  readonly refName?: string;
};

export interface CatalogEntry {
  /** `area.verb`, unique. The propose tool is `propose_` + the id with `.` → `_`. */
  readonly id: string;
  /** The verb phrase a card and a wizard title show, e.g. "Create a dashboard". */
  readonly title: string;
  readonly method: CatalogMethod;
  /** The route below the global prefix, with `:param` placeholders, e.g. `/dashboards/:id/widgets`. */
  readonly path: string;
  /** One schema per path parameter, the same rule the controller parses it with. */
  readonly params: Readonly<Record<string, ZodTypeAny>>;
  /**
   * The schema the controller parses the body with — the same export, by
   * identity (`catalog.spec.ts`). A route that takes no body uses
   * `z.object({}).strict()`, and its stored and sent body is `{}`.
   */
  readonly body: ZodTypeAny;
  /** The export name of `body` in `@bms/shared`, or `null` for a route that takes no body (`tests/f3.85-catalog-coverage`). */
  readonly bodyName: string | null;
  /** Body keys the user types on the Confirm card and the model never sees (none in release 1). */
  readonly clientOnly: readonly string[];
  /**
   * `F3.86` PR 2: the schema the model proposes with, when it differs from
   * `body` — an entry with `clientOnly` fields whose body is not a plain
   * object, or whose proposal rule is narrower than the route's (a user
   * create that never names the global `admin` role, PR 4). Absent: the body,
   * without its `clientOnly` fields (`modelBodyOf`). It binds the model
   * only: a human wizard's Review step checks the route's own body
   * (`bodyProblems`).
   */
  readonly modelBody?: ZodTypeAny;
  /** The export name of `modelBody` in `@bms/shared`, when there is one (PR 4 gates it with the first such entry). */
  readonly modelBodyName?: string;
  /**
   * `F4.266` (ADR 0090 Amendment 3 C6): a short statement of a large body's
   * shape, appended to the propose tool's field list so the model can propose
   * without reading the body with `describe_change`. Built from the body's own
   * schemas, never restated by hand. Absent: the field list alone.
   */
  readonly bodyGuide?: string;
  /**
   * `F3.86` PR 2: who makes a pending change for this entry. `model` (the
   * default): the model, through a `propose_*` tool. `server`: the server
   * itself, after a skill step (the onboarding commit, decision 7) — no
   * propose tool is made for it.
   */
  readonly proposer?: "model" | "server";
  /**
   * `F3.87` PR 2 (Amendment 3 A1): the roles whose propose registry names
   * this entry's tool, and whom `propose()` admits for it. Absent: every
   * copilot role. The route's own check still runs on Confirm.
   */
  readonly offeredTo?: readonly UserRole[];
  /**
   * `F3.87` PR 2 (Amendment 3 A3): the entry's route is multipart. The
   * model sends the file as the `svg` text in its `modelBody`; the pending
   * row keeps it under a `cardOnly` key, and on Confirm the browser sends it
   * as the `fileField` part. The interceptor hashes the file's bytes.
   */
  readonly upload?: {
    readonly fileField: "file";
    readonly contentType: "image/svg+xml";
    readonly maxBytes: number;
  };
  /**
   * `F3.87` PR 2: keys the server stores in the pending row's body for the
   * card alone (a layout's `baseline`, an upload's `svgText`). They are not
   * body fields, the hash leaves them out, and the browser strips them
   * before it sends the write.
   */
  readonly cardOnly?: readonly string[];
  /**
   * `F4.247` (ADR 0099 Amendment 5 C1): the entry's write takes an `If-Match`
   * precondition. The target resolver reads the row's `updated_at`, the propose
   * tool stores it on the pending change (and refuses the proposal when it read
   * none), and the browser sends it as `If-Match` on Confirm. Absent: no
   * precondition.
   */
  readonly precondition?: "updatedAt";
  readonly risk: CatalogRisk;
  readonly target: CatalogTarget;
  readonly refs: readonly CatalogRef[];
  readonly formulas: readonly CatalogFormula[];
  /** The fields-only steps; a route with no body fields has none and its wizard is the Review step alone (ruling Q6). */
  readonly steps: readonly CatalogStep[];
  /** One sentence that names the target (`catalog.spec.ts` checks it). */
  summary(input: CatalogSummaryInput): string;
}

/** A write route the copilot never proposes, and why (decision 2's exclusion list). */
export type ExcludedRoute = {
  readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly reason: string;
};
