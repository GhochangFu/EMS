/**
 * The `bms.locations.meta` key that marks a row the seed owns (owner ruling
 * 16). Its value is the row's canonical slug, which is fixed by the seed's own
 * catalog: the seed finds its row by this key first, so an administrator's
 * edit of the row's slug or code no longer loses the row.
 *
 * Its own module, with no import, so `apps/api` can read it from `@bms/db`
 * without loading the seed: the admin location writes and the onboarding
 * commit never accept it from a request (owner ruling 20).
 */
export const SEED_LOCATION_KEY = "seedKey";
