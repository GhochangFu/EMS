/**
 * `F3.87` PR 7 / ADR 0099 Amendment 3, plan D8 — whether the administrator's
 * **own message** asks for an asset or point to be created.
 *
 * On a turn that carries a file, the propose registry drops `asset.create`,
 * `assetPoint.create` and `pointKey.create` unless the typed text asks for
 * them: an image or a PDF is never the reason an asset is created. The shape
 * is `accessIntentOf`'s (`copilot-access-intent.ts`) — a small, literal word
 * list matched whole and case-insensitively. A false positive only offers the
 * tools (the user still confirms every card); a false negative answers "ask
 * for it directly".
 */
const ASSET_WORDS = [
  "asset",
  "assets",
  "point",
  "points",
  "create",
  "add",
  "register",
] as const;

const ASSET_WORD = new RegExp(`(?:^|[^a-z0-9-])(?:${ASSET_WORDS.join("|")})(?![a-z0-9-])`, "i");

/** Whether the user's own message names an asset word (whole words, any case). */
export function assetIntentOf(message: string): boolean {
  return ASSET_WORD.test(message);
}

/** The entries an attachment turn offers only when the user's own words ask (D8). */
export const ASSET_CREATE_IDS: ReadonlySet<string> = new Set(["asset.create", "assetPoint.create", "pointKey.create"]);

/** The reply when the model reaches for an asset create the turn does not have. */
export const PROPOSE_ASSET_NOT_ASKED_ERROR = "An asset or point is created from a file only when your own message asks for it.";
