import { MAX_DASHBOARD_TABS, RESERVED_DASHBOARD_TAB_KEYS, SITE_ASSETS_TAB, dashboardTabKeySchema } from "./dashboard-tabs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** `assets` is the site page's own segment (plan D4), so a dashboard tab may not take it. */
export function assetsKeyIsRefused(): void {
  assert(dashboardTabKeySchema.safeParse("assets").success === false, "the key `assets` must be refused");
}

/** The regex is lowercase-only, so the reserved word is not dodged by a capital. */
export function capitalisedAssetsKeyIsRefused(): void {
  assert(dashboardTabKeySchema.safeParse("Assets").success === false, "the key `Assets` must be refused");
}

export function ordinaryKeyIsAccepted(): void {
  assert(dashboardTabKeySchema.safeParse("sld").success === true, "the key `sld` must be accepted");
  assert(dashboardTabKeySchema.safeParse("ups-1").success === true, "the key `ups-1` must be accepted");
}

export function keyLengthBoundIs64(): void {
  assert(dashboardTabKeySchema.safeParse("a".repeat(64)).success === true, "64 characters must be accepted");
  assert(dashboardTabKeySchema.safeParse("a".repeat(65)).success === false, "65 characters must be refused");
  assert(dashboardTabKeySchema.safeParse("").success === false, "the empty key must be refused");
}

/** One declaration: the reserved list is built from `SITE_ASSETS_TAB`, and the cap is the plan's 8. */
export function reservedKeysAndCapArePinned(): void {
  assert(
    RESERVED_DASHBOARD_TAB_KEYS.length === 1 && RESERVED_DASHBOARD_TAB_KEYS[0] === SITE_ASSETS_TAB,
    "only the site page's assets segment is reserved",
  );
  assert(SITE_ASSETS_TAB === "assets", "the Assets & RTUs route segment is `assets`");
  assert(MAX_DASHBOARD_TABS === 8, "a dashboard carries at most 8 tabs");
}
