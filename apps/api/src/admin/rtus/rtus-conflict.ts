/**
 * `F4.60` / `F4.141` — the refusals `RtusAdminService` answers a duplicate on
 * one of the four `bms.rtus` unique constraints with, and the narrow
 * translation that produces them.
 *
 * ## What it fixes
 *
 * `bms.rtus` carries four unique constraints, and `create` and `update` carry
 * no `onConflict` (a duplicate is refused, never merged). Without this a write
 * that collided with one raised `23505`, reached Nest's default handler and
 * became `500 {"statusCode":500,"message":"Internal server error"}` — recorded
 * as a server fault for a value the caller chose. `F4.60` mapped
 * `rtus_rtu_code_idx`; `F4.141` maps the other three.
 *
 * ## The four, and why each is reachable
 *
 * `updateRtuBodySchema` is `createRtuBodySchema.omit({ locationId }).partial()`
 * and `update`'s `.set()` restates every column, so each constraint is
 * reachable through both `POST /admin/rtus` and `PATCH /admin/rtus/:id`:
 *
 * - `rtus_rtu_code_idx` (migration `0071`) — `(rtu_code)` where neither `NULL`
 *   nor `''`. Fleet-wide.
 * - `rtus_external_rtu_idx` (`0016`) — `(external_rtu_id)` where not `NULL`.
 *   Fleet-wide.
 * - `rtus_mqtt_topic_idx` (`0016`) — `(mqtt_topic)` where not `NULL`.
 *   Fleet-wide.
 * - `rtus_location_code_unique` (`0016`) — `(location_id, code)`. Per location.
 *
 * ## Why 409 and not 400
 *
 * Two translations of a `23505` already exist in this codebase and they answer
 * differently. Both are right for their route, and this one is a third case
 * rather than a copy of either:
 *
 * - `AssetTemplatesInstantiateService.translateAssetCodeCollision`
 *   (`asset-templates-instantiate.service.ts`) answers **409**. Its stated
 *   reason: *the service generates the codes itself*, so a collision means one
 *   was taken mid-batch and the caller retries unchanged — which is exactly what
 *   `409 Conflict` says.
 * - `onboarding-commit-conflict.ts` answers **400**. Its stated reason: the
 *   operator typed the code, so retrying unchanged repeats the failure and the
 *   answer has to *name the field to correct*. A draft is a batch, and the web
 *   client renders a `z.flatten()`-shaped `{formErrors, fieldErrors}` body, so
 *   400 is the only status that can carry the field.
 *
 * Neither reason transfers. This is a single-resource write — one `POST
 * /admin/rtus` or one `PATCH /admin/rtus/:id` — whose *identity key* conflicts
 * with existing state rather than with a sibling in its own payload. There is no
 * batch to name a field within, and the caller does not retry unchanged: it
 * chooses a different value. `409 Conflict` is the status for a request that
 * cannot be applied to the current state of the resource, and this same service
 * already answers 409 for its one other state conflict — `deactivate`'s "Cannot
 * deactivate RTU with active assets". Answering 400 here would make one service
 * report two state conflicts two ways. The reasoning is about the route, not
 * the constraint, so all four answer 409.
 *
 * **Restated, not shared with onboarding.** `COMMIT_UNIQUE_CONFLICTS`'s
 * sentences are batch-phrased ("… in this draft …") and would be false on one
 * `POST`; importing that map would also import its field type and its 400
 * shape. So the sentences below are this route's own.
 *
 * ## Why each message is a constant and nothing else
 *
 * **On a global key the colliding row may belong to another tenant.** The three
 * `scope: "global"` keys have no `organization_id` — for `rtu_code` that is the
 * point, since the ingest host routes by it across the whole fleet — so they
 * refuse across organizations. Naming *where* the taken row lives, even
 * anonymously, turns a duplicate into the disclosure that a second tenant
 * exists. So a global message must not imply one: it says the key is taken and
 * says nothing about who holds it.
 *
 * **`scope: "location"` may name the location, and only that.** The key of
 * `rtus_location_code_unique` includes `location_id`. On `create` the caller
 * has passed `canManageLocation` for `body.locationId`; on `update` the row's
 * location is `existing.locationId`, which the caller has also passed, and
 * `location_id` is not updatable. The colliding row is therefore always at a
 * location the caller manages, and "another RTU at this location" discloses
 * nothing it could not list. The spec's cross-tenant word scan skips this one
 * entry and pins the set it does scan.
 *
 * Postgres withholds the value too. `BuildIndexValueDescription` returns NULL
 * when row-level security is enabled on the relation, and `bms.rtus` keeps its
 * `tenant_isolation` policy under `FORCE` (migration `0047`). Probed live on
 * `rtus_rtu_code_idx`: as `bms_tenant` — the role `withTenant` connects as — and
 * as `bms_owner`, a duplicate arrives with `code`, `constraint`, `table` and
 * `schema` but **no `DETAIL` line at all**; only `bms_fleet`/`bms_app`, which
 * hold `BYPASSRLS`, see `Key (rtu_code)=(…) already exists.` The full two-role
 * probe is recorded once, at the head of `onboarding-commit-conflict.ts`; it is
 * not restated here because two copies of a measurement drift.
 *
 * That is a reason not to rely on the server, not a reason to relax. §4.3
 * forbids echoing the input back in a refusal, and `detail` *is* the input. Each
 * message below is built from a constant and from nothing on `err` — not
 * `detail`, not `message`, not `table`, not `schema`.
 *
 * No logger (§9.6): this is a pure function on a caller-supplied value, and the
 * one field worth logging is the one that must not be.
 */
import { ConflictException } from "@nestjs/common";

/**
 * The whole `rtu_code` refusal body, owner-ruled verbatim (`F4.60`).
 *
 * Exported so the spec can assert the rendered message *equals* it, which is
 * what stops a later edit appending "…in another organization" to the sentence.
 */
export const RTU_CODE_TAKEN_MESSAGE =
  "That rtuCode is already taken. It is the device key the ingest host routes by, " +
  "so two RTUs cannot share one. Choose a different rtuCode.";

/** The `external_rtu_id` refusal body, owner-ruled verbatim (`F4.141`, 2026-09-27). */
export const RTU_EXTERNAL_ID_TAKEN_MESSAGE =
  "That externalRtuId is already taken. Choose a different externalRtuId.";

/** The `mqtt_topic` refusal body, owner-ruled verbatim (`F4.141`, 2026-09-27). */
export const RTU_MQTT_TOPIC_TAKEN_MESSAGE =
  "That mqttTopic is already taken. Choose a different mqttTopic.";

/** The `(location_id, code)` refusal body, owner-ruled verbatim (`F4.141`, 2026-09-27). */
export const RTU_LOCATION_CODE_TAKEN_MESSAGE =
  "Another RTU at this location already uses that code. Choose a different code.";

/**
 * `"global"` — the key has no `location_id` or `organization_id`, so the
 * colliding row may be another tenant's and the message must not say where it
 * lives. `"location"` — the key includes `location_id`, which the caller
 * manages on both write paths, so the message may say "at this location".
 */
export type RtuUniqueConflictScope = "global" | "location";

export type RtuUniqueConflict = {
  readonly scope: RtuUniqueConflictScope;
  readonly message: string;
};

/**
 * Constraint name → the refusal it answers.
 *
 * A `Map`, not an object literal, for the reason `onboarding-commit-conflict.ts`
 * records: a lookup by a driver-supplied string on a plain object finds
 * `Object.prototype` members (`constructor`, `toString`, …).
 */
export const RTU_UNIQUE_CONFLICTS: ReadonlyMap<string, RtuUniqueConflict> = new Map<
  string,
  RtuUniqueConflict
>([
  ["rtus_rtu_code_idx", { scope: "global", message: RTU_CODE_TAKEN_MESSAGE }],
  ["rtus_external_rtu_idx", { scope: "global", message: RTU_EXTERNAL_ID_TAKEN_MESSAGE }],
  ["rtus_mqtt_topic_idx", { scope: "global", message: RTU_MQTT_TOPIC_TAKEN_MESSAGE }],
  ["rtus_location_code_unique", { scope: "location", message: RTU_LOCATION_CODE_TAKEN_MESSAGE }],
]);

/**
 * A duplicate on one of the four mapped constraints as a `ConflictException`,
 * and **anything else returned unchanged** — the same object, so
 * `throw translateRtuUniqueConflict(err)` re-throws the original with its stack
 * and its `cause` intact.
 *
 * **Narrow on both axes, and the narrowing is the safety argument.** This copies
 * the shape of `commitUniqueConflict` (in `onboarding-commit-conflict.ts`)
 * rather than `translateAssetCodeCollision`, which branches on the constraint
 * name alone. `constraint` is set on other integrity violations too — a `23503`
 * foreign-key failure names the foreign key — so a write that violated one is
 * not a duplicate value and must not be described as one. The SQLSTATE is
 * therefore tested as well.
 */
export function translateRtuUniqueConflict(err: unknown): unknown {
  if (typeof err !== "object" || err === null) {
    return err;
  }
  const { code, constraint } = err as { code?: unknown; constraint?: unknown };
  if (code !== "23505" || typeof constraint !== "string") {
    return err;
  }
  const entry = RTU_UNIQUE_CONFLICTS.get(constraint) ?? null;
  if (entry === null) {
    return err;
  }
  return new ConflictException(entry.message);
}
