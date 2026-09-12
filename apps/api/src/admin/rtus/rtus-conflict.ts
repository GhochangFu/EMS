/**
 * `F4.60` — the one refusal `RtusAdminService` answers a duplicate `rtu_code`
 * with, and the narrow translation that produces it.
 *
 * ## What it fixes
 *
 * Migration `0071` adds `rtus_rtu_code_idx`, unique on `rtu_code` fleet-wide
 * where the column is neither `NULL` nor `''`. `create` and `update` carry no
 * `onConflict`, so without this a second RTU claiming a taken `rtu_code` raised
 * `23505`, reached Nest's default handler and became
 * `500 {"statusCode":500,"message":"Internal server error"}` — recorded as a
 * server fault for a value the caller chose.
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
 * chooses a different `rtuCode`. `409 Conflict` is the status for a request that
 * cannot be applied to the current state of the resource, and this same service
 * already answers 409 for its one other state conflict — `deactivate`'s "Cannot
 * deactivate RTU with active assets". Answering 400 here would make one service
 * report two state conflicts two ways.
 *
 * ## Why the message is a constant and nothing else
 *
 * **The colliding row may belong to another tenant.** `rtus_rtu_code_idx` has no
 * `organization_id` in its key — that is the point of it, since the ingest host
 * routes by `rtu_code` across the whole fleet — so it refuses across
 * organizations exactly as `rtus_external_rtu_idx` and `rtus_mqtt_topic_idx` do.
 * Naming *where* the taken row lives, even anonymously, turns a duplicate into
 * the disclosure that a second tenant exists. So the message must not imply one:
 * it says the key is taken and says nothing about who holds it.
 *
 * Postgres withholds the value too. `BuildIndexValueDescription` returns NULL
 * when row-level security is enabled on the relation, and `bms.rtus` keeps its
 * `tenant_isolation` policy under `FORCE` (migration `0047`). Probed live on
 * this index: as `bms_tenant` — the role `withTenant` connects as — and as
 * `bms_owner`, a duplicate `rtu_code` arrives with `code`, `constraint`, `table`
 * and `schema` but **no `DETAIL` line at all**; only `bms_fleet`/`bms_app`, which
 * hold `BYPASSRLS`, see `Key (rtu_code)=(…) already exists.` The full two-role
 * probe is recorded once, at the head of `onboarding-commit-conflict.ts`; it is
 * not restated here because two copies of a measurement drift.
 *
 * That is a reason not to rely on the server, not a reason to relax. §4.3
 * forbids echoing the input back in a refusal, and `detail` *is* the input. The
 * message below is built from a constant and from nothing on `err` — not
 * `detail`, not `message`, not `table`, not `schema`.
 *
 * No logger (§9.6): this is a pure function on a caller-supplied value, and the
 * one field worth logging is the one that must not be.
 */
import { ConflictException } from "@nestjs/common";

/**
 * The whole refusal body, owner-ruled verbatim.
 *
 * Exported so the spec can assert the rendered message *equals* it, which is
 * what stops a later edit appending "…in another organization" to the sentence.
 */
export const RTU_CODE_TAKEN_MESSAGE =
  "That rtuCode is already taken. It is the device key the ingest host routes by, " +
  "so two RTUs cannot share one. Choose a different rtuCode.";

/**
 * A duplicate `rtu_code` as a `ConflictException`, and **anything else returned
 * unchanged** — the same object, so `throw translateRtuCodeCollision(err)`
 * re-throws the original with its stack and its `cause` intact.
 *
 * **Narrow on both axes, and the narrowing is the safety argument.** This copies
 * the shape of `commitUniqueConflict` (in `onboarding-commit-conflict.ts`)
 * rather than `translateAssetCodeCollision`, which branches on the constraint
 * name alone. `constraint` is set on other integrity violations too — a `23503`
 * foreign-key failure names the foreign key — so a write that violated one is
 * not a duplicate value and must not be described as one. The SQLSTATE is
 * therefore tested as well.
 */
export function translateRtuCodeCollision(err: unknown): unknown {
  if (typeof err !== "object" || err === null) {
    return err;
  }
  const { code, constraint } = err as { code?: unknown; constraint?: unknown };
  if (code !== "23505" || constraint !== "rtus_rtu_code_idx") {
    return err;
  }
  return new ConflictException(RTU_CODE_TAKEN_MESSAGE);
}
