import { SEED_LOCATION_KEY } from "@bms/db";

/**
 * `F4.170` owner ruling 20 — `meta.seedKey` is seed-owned. The seed finds each
 * location it owns by this key (owner ruling 16), so a key written through the
 * admin API could forge, move or wipe a seed identity: the boot stops, an
 * administrator's row is taken over, or the decommissioned fixture's
 * `active = false` lands on a live site. The location create, the location
 * update and the onboarding commit therefore never take the key from a
 * request, and only the seed writes it.
 */

type Meta = Record<string, unknown>;

function withoutSeedKey(meta: Meta): Meta {
  const rest = { ...meta };
  delete rest[SEED_LOCATION_KEY];
  return rest;
}

/** The `meta` a create (location POST, onboarding commit) stores: the request's, less the key. */
export function requestMetaForCreate(meta: Meta | undefined): Meta | null {
  return meta === undefined ? null : withoutSeedKey(meta);
}

/**
 * The `meta` an update stores when the request replaces it: the request's,
 * less any key it carries, plus the key the row already has, if any. A row
 * with no key gets none.
 */
export function requestMetaForUpdate(meta: Meta, stored: unknown): Meta {
  const next = withoutSeedKey(meta);
  if (stored !== null && typeof stored === "object" && Object.prototype.hasOwnProperty.call(stored, SEED_LOCATION_KEY)) {
    next[SEED_LOCATION_KEY] = (stored as Meta)[SEED_LOCATION_KEY];
  }
  return next;
}
