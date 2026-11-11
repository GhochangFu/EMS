import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * `F4.17` / ADR 0125 decision 11 — the service-account token format.
 *
 *     bms_sat_<12-character id>_<43-character secret>
 *
 * - The **id** is 12 characters of `[A-Za-z0-9]`, drawn uniformly (no modulo
 *   bias): the public half, the verifier's lookup key, and the only part ever
 *   shown after creation.
 * - The **secret** is 32 random bytes in base64url without padding (43
 *   characters). Only its SHA-256 is stored. A slow hash is not needed for a
 *   256-bit random secret, and it would put bcrypt on every request.
 *
 * The prefix lets the guard tell a token from a JWT before any parse, and lets
 * secret scanners recognise a leaked one.
 */

export const SERVICE_TOKEN_PREFIX = "bms_sat_";

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 12;
const SECRET_BYTES = 32;

/** The whole token, anchored: a token is exactly this or it is not a token. */
export const SERVICE_TOKEN_PATTERN = /^bms_sat_([A-Za-z0-9]{12})_([A-Za-z0-9_-]{43})$/;

export type IssuedServiceToken = Readonly<{
  /** The full token, returned once by the create response and never stored. */
  token: string;
  tokenId: string;
  /** SHA-256 of the secret, 32 bytes — what `bms.service_account_tokens.token_hash` holds. */
  tokenHash: Buffer;
}>;

export type ParsedServiceToken = Readonly<{ tokenId: string; secret: string }>;

/** True when `value` carries the prefix, so the guard routes it here and never to the JWT path. */
export function looksLikeServiceToken(value: string): boolean {
  return value.startsWith(SERVICE_TOKEN_PREFIX);
}

/** Splits a token into its id and secret, or `null` for anything malformed — before any database read. */
export function parseServiceToken(value: string): ParsedServiceToken | null {
  const match = SERVICE_TOKEN_PATTERN.exec(value);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { tokenId: match[1], secret: match[2] };
}

/** SHA-256 of a token's secret half — the value `token_hash` stores (32 bytes). */
export function hashServiceTokenSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Constant-time comparison of a presented secret against a stored hash. */
export function secretMatches(secret: string, storedHash: Buffer | Uint8Array): boolean {
  const presented = hashServiceTokenSecret(secret);
  const stored = Buffer.from(storedHash);
  return stored.length === presented.length && timingSafeEqual(presented, stored);
}

function randomTokenId(): string {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i += 1) {
    id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  }
  return id;
}

/** Mints a new token. The caller stores `tokenId` and `tokenHash`, and shows `token` once. */
export function issueServiceToken(): IssuedServiceToken {
  const tokenId = randomTokenId();
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  return {
    token: `${SERVICE_TOKEN_PREFIX}${tokenId}_${secret}`,
    tokenId,
    tokenHash: hashServiceTokenSecret(secret),
  };
}
