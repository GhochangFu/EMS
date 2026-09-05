import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import type { CalcAggregate, CalcScope } from "@bms/shared";
import { crossRefKey } from "@bms/shared";

import { FLEET_DRIZZLE } from "../database/database.tokens";
import type { AssetCode, AssetId, CrossRefKey, GraphDefinition, Membership } from "./calc-graph";

/**
 * Resolves what a `bms-calc-v2` formula's cross-asset references name **right
 * now** (ADR 0055 decisions 8, 9 and 12; `F2.9` Task 11) — the `Membership`
 * that `buildCalcGraph` takes, keyed by the owning asset.
 *
 * **Why this is a fleet read.** The same reason `CalcDefinitionsService`
 * records: every derived point from every tenant, with no JWT and no org
 * context — a cross-organization system read with no tenant actor (ADR 0043
 * Amendments 2 and 3). On the tenant pool the 0047 policy on `assets`,
 * `asset_groups`, `template_points` and `asset_points` would return nothing,
 * every aggregate would resolve to an empty member set, and every site sum
 * would compute `0` quietly.
 *
 * **The `location_id` filter is decision 12's containment, not an
 * optimisation.** A qualified code `{CODE.key}` and a scope (`@site`,
 * `@domain('…')`, `@group('…')`) are both resolved against the **owner's**
 * `location_id` — the location of the asset whose formula holds the reference.
 * `asset_groups` is unique on `(location_id, code)` (`0010`), so a group code
 * is unambiguous only *within* a location; `assets.code` is globally unique,
 * so a global code lookup would *succeed* across locations and across
 * organizations, and the formula would silently read another site's tag. Do
 * not "simplify" either statement into a lookup without the owner's location.
 * `tests/adr-0055-calc-v2-invariants.test.ts` part (d) scans this file for
 * exactly that reason.
 *
 * **Not cached, and once per sweep** (plan design decision 8): the detector
 * must see the membership set as it is, which is the ADR's stated reason for
 * evaluation-time authority. Three statements per call, each batched over
 * every owner, reference and member at once — never one query per member,
 * per owner or per reference (ADR 0037 decision 7's refusal of a per-tick cap
 * is the same trade: slow beats a silently computed subset).
 *
 * "Declares the referenced point" is a **disjunction**, and both halves are
 * load-bearing (plan design decision 8, ruled at Q5): the asset's pinned
 * template declares the key, **or** the asset has an active `asset_points`
 * row for it. A hand-created asset with a mapped `kw` has real telemetry and
 * would otherwise be silently missing from a site sum. Inactive assets are
 * never members — and, since the PR 2 review, never resolve a `{CODE.key}`
 * either: both statements carry `a.active`, because one decision reached
 * through two syntaxes must not give two answers. **The owner is in its own
 * member set when it declares the
 * key** — that is what makes `total_kw = sum({total_kw} @site)` a one-edge
 * cycle `buildCalcGraph` can see, rather than an invisible one.
 */
@Injectable()
export class CalcScopeService {
  constructor(@Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb) {}

  /**
   * Resolves every cross-asset reference in `defs` against its owner's
   * location. Every owner that holds at least one reference gets an entry in
   * both maps, and every reference it holds gets a key — `null` for an
   * unresolved qualified code, `[]` for an aggregate with no members — so a
   * caller can tell "not resolved" from "never asked". An owner whose asset
   * row no longer exists resolves everything to `null` / `[]` the same way.
   *
   * Every `members` key is `crossRefKey(node)`; the aggregate function is part
   * of the key but not of the membership, so `sum` and `avg` over one scope
   * share a request and get separate entries.
   */
  async resolveMembership(defs: readonly MembershipDefinition[]): Promise<Membership> {
    const qualified = new Map<AssetId, Map<AssetCode, AssetId | null>>();
    const members = new Map<AssetId, Map<CrossRefKey, readonly MemberPair[]>>();

    const ownerIds = [...new Set(defs.filter((def) => def.crossRefs.length > 0).map((def) => def.assetId))];
    if (ownerIds.length === 0) {
      return { qualified, members };
    }
    const locationByOwner = await this.readOwnerLocations(ownerIds);

    // Pass 1 — collect the distinct requests. Two owners at one location that
    // hold the same reference share a request; the answer fans out below.
    const scopeRequests = new Map<string, ScopeRequest>();
    const codeRequests = new Map<string, CodeRequest>();
    for (const def of defs) {
      const locationId = locationByOwner.get(def.assetId);
      for (const ref of def.crossRefs) {
        if (ref.kind === "qref") {
          if (locationId !== undefined) {
            const request = { locationId, code: ref.assetCode };
            codeRequests.set(codeRequestKey(request), request);
          }
        } else if (locationId !== undefined) {
          const request = scopeRequest(locationId, ref);
          scopeRequests.set(scopeRequestKey(request), request);
        }
      }
    }

    const membersByRequest = await this.readScopeMembers([...scopeRequests.values()]);
    const assetIdByCodeRequest = await this.readQualifiedCodes([...codeRequests.values()]);

    // Pass 2 — fan the answers out per owner, keyed by the owner's own
    // reference so `buildCalcGraph` looks them up by `crossRefKey` verbatim.
    for (const def of defs) {
      if (def.crossRefs.length === 0) continue;
      const ownerQualified = qualified.get(def.assetId) ?? new Map<AssetCode, AssetId | null>();
      const ownerMembers = members.get(def.assetId) ?? new Map<CrossRefKey, readonly MemberPair[]>();
      const locationId = locationByOwner.get(def.assetId);
      for (const ref of def.crossRefs) {
        if (ref.kind === "qref") {
          const resolved =
            locationId === undefined ? null : assetIdByCodeRequest.get(codeRequestKey({ locationId, code: ref.assetCode }));
          ownerQualified.set(ref.assetCode, resolved ?? null);
        } else {
          const pairs =
            locationId === undefined ? [] : (membersByRequest.get(scopeRequestKey(scopeRequest(locationId, ref))) ?? []);
          ownerMembers.set(crossRefKey(ref), pairs);
        }
      }
      qualified.set(def.assetId, ownerQualified);
      members.set(def.assetId, ownerMembers);
    }

    return { qualified, members };
  }

  /** `assets` by id, batched — the owners' `location_id`, which every other read is relative to. */
  private async readOwnerLocations(ownerIds: readonly AssetId[]): Promise<Map<AssetId, string>> {
    const result = await this.fleetDb.execute<{ id: string; location_id: string }>(
      sql`SELECT id, location_id
            FROM bms.assets
           WHERE id = ANY(${sql.param(ownerIds)}::uuid[])`,
    );
    return new Map(result.rows.map((row) => [row.id, row.location_id]));
  }

  /**
   * Statement (1) — aggregate members, for every distinct
   * `(ownerLocationId, pointKey, scope)` at once. Members are the **active**
   * assets at the owner's location, narrowed by the scope, that declare the
   * key by template or by an active mapping (the disjunction the class
   * docblock explains). The group branch joins `asset_groups` on
   * `g.location_id = a.location_id`, which is the `(location_id, code)`
   * uniqueness doing its work: a second `IT_LOAD` at another location is a
   * different group.
   */
  private async readScopeMembers(requests: readonly ScopeRequest[]): Promise<Map<string, readonly MemberPair[]>> {
    const out = new Map<string, MemberPair[]>();
    for (const request of requests) {
      out.set(scopeRequestKey(request), []);
    }
    if (requests.length === 0) {
      return out;
    }
    const result = await this.fleetDb.execute<ScopeMemberRow>(
      sql`WITH req AS (
            SELECT location_id, point_key, scope_kind, scope_code
              FROM unnest(
                ${sql.param(requests.map((r) => r.locationId))}::uuid[],
                ${sql.param(requests.map((r) => r.pointKey))}::varchar[],
                ${sql.param(requests.map((r) => r.scopeKind))}::text[],
                ${sql.param(requests.map((r) => r.scopeCode))}::text[]
              ) AS r(location_id, point_key, scope_kind, scope_code)
          )
          SELECT r.location_id, r.point_key, r.scope_kind, r.scope_code, a.id AS asset_id
            FROM req r
            JOIN bms.assets a
              ON a.location_id = r.location_id
             AND a.active
           WHERE (
                   r.scope_kind = 'site'
                OR (r.scope_kind = 'domain' AND a.domain = r.scope_code)
                OR (r.scope_kind = 'group' AND EXISTS (
                      SELECT 1
                        FROM bms.asset_group_members m
                        JOIN bms.asset_groups g ON g.id = m.asset_group_id
                       WHERE g.location_id = a.location_id
                         AND g.code = r.scope_code
                         AND m.asset_id = a.id))
                 )
             AND (
                   EXISTS (
                      SELECT 1 FROM bms.template_points tp
                       WHERE tp.template_id = a.template_id
                         AND tp.point_key = r.point_key)
                OR EXISTS (
                      SELECT 1 FROM bms.asset_points ap
                       WHERE ap.asset_id = a.id
                         AND ap.point_key = r.point_key
                         AND ap.active)
                 )
           ORDER BY r.location_id, r.point_key, r.scope_kind, r.scope_code, a.id`,
    );
    for (const row of result.rows) {
      const key = scopeRequestKey({
        locationId: row.location_id,
        pointKey: row.point_key,
        scopeKind: row.scope_kind,
        scopeCode: row.scope_code,
      });
      out.get(key)?.push({ assetId: row.asset_id, pointKey: row.point_key });
    }
    return out;
  }

  /**
   * Statement (2) — qualified codes, for every distinct
   * `(ownerLocationId, assetCode)` at once. A code resolves only to an asset
   * **at the owner's location**; the `WHERE` below is the whole of decision
   * 12's containment for `{CODE.key}`, since `assets.code` is globally unique
   * and the join alone would find the asset wherever it lives.
   *
   * **`a.active` is in the same `WHERE`, and it is the same rule statement (1)
   * applies.** Q5 ruled inactive assets are never members of an aggregate; a
   * qualified code naming a deactivated asset is the same asset in the same
   * state, reached through a different syntax, and the two halves of one
   * decision must not disagree. The reference then resolves to nothing and the
   * sweep counts `unknown_asset_reference`, which is the honest report:
   * deactivating an asset is an operator saying "this equipment is not
   * reporting", and a formula that keeps reading its last stored value
   * afterwards is decision 5's staleness rule being routed around.
   *
   * It lives in the `WHERE` rather than the `JOIN … ON` deliberately:
   * `tests/adr-0055-calc-v2-invariants.test.ts` part (d) reads this statement's
   * `WHERE` as the containment clause, and moving either predicate into the
   * join would leave that scan looking at a clause with nothing in it.
   */
  private async readQualifiedCodes(requests: readonly CodeRequest[]): Promise<Map<string, AssetId>> {
    const out = new Map<string, AssetId>();
    if (requests.length === 0) {
      return out;
    }
    const result = await this.fleetDb.execute<{ location_id: string; code: string; asset_id: string }>(
      sql`WITH req AS (
            SELECT location_id, code
              FROM unnest(
                ${sql.param(requests.map((r) => r.locationId))}::uuid[],
                ${sql.param(requests.map((r) => r.code))}::varchar[]
              ) AS r(location_id, code)
          )
          SELECT r.location_id, r.code, a.id AS asset_id
            FROM req r
            JOIN bms.assets a ON a.code = r.code
           WHERE a.location_id = r.location_id
             AND a.active`,
    );
    for (const row of result.rows) {
      out.set(codeRequestKey({ locationId: row.location_id, code: row.code }), row.asset_id);
    }
    return out;
  }
}

/**
 * The slice of a definition membership needs: who owns the formula and what
 * it references. A `CalcDefinition` and a `GraphDefinition` both satisfy it
 * structurally, so the sweep and the save-time detector hand in what they
 * already hold.
 */
export type MembershipDefinition = Pick<GraphDefinition, "assetId" | "crossRefs">;

type MemberPair = { readonly assetId: AssetId; readonly pointKey: string };

type ScopeRequest = {
  readonly locationId: string;
  readonly pointKey: string;
  readonly scopeKind: CalcScope["kind"];
  /** `''` for `@site`, which names no code — the arrays `unnest` zips must be the same length. */
  readonly scopeCode: string;
};

type CodeRequest = { readonly locationId: string; readonly code: AssetCode };

type ScopeMemberRow = {
  location_id: string;
  point_key: string;
  scope_kind: CalcScope["kind"];
  scope_code: string;
  asset_id: string;
};

function scopeRequest(locationId: string, ref: CalcAggregate): ScopeRequest {
  return {
    locationId,
    pointKey: ref.pointKey,
    scopeKind: ref.scope.kind,
    scopeCode: ref.scope.kind === "site" ? "" : ref.scope.code,
  };
}

/** A JSON tuple, not a joined string: point keys and group codes are
 * unconstrained text (the Q1 charset row is still owed), so no separator is
 * safe, and only a real encoding keeps the request key injective. */
function scopeRequestKey(request: ScopeRequest): string {
  return JSON.stringify([request.locationId, request.pointKey, request.scopeKind, request.scopeCode]);
}

function codeRequestKey(request: CodeRequest): string {
  return JSON.stringify([request.locationId, request.code]);
}
