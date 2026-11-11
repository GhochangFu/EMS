import { createHash } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

/**
 * `F4.17` / ADR 0125 decisions 3 and 8 — how a request becomes a counter key.
 *
 * Key shape: `rl:v1:<stage>:<bucket>:<subject>:<window>`. The window index is
 * part of the key, so a counter that is never read again simply expires; the
 * store sets a TTL on first hit (Redis runs `noeviction`, so a key without one
 * would stay forever).
 */

const MAX_SUBJECT_LENGTH = 64;

export type RateLimitStage = "ip" | "identity";

/** A subject as it may appear inside a key: long or unusual ones are hashed, so keys stay bounded. */
export function safeSubject(subject: string): string {
  return subject.length > MAX_SUBJECT_LENGTH || /[^A-Za-z0-9.:_-]/.test(subject)
    ? `h_${createHash("sha256").update(subject).digest("hex").slice(0, 32)}`
    : subject;
}

/** Builds the counter key. */
export function rateLimitKey(
  stage: RateLimitStage,
  bucket: string,
  subject: string,
  windowIndex: number,
): string {
  return `rl:v1:${stage}:${bucket}:${safeSubject(subject)}:${windowIndex}`;
}

/** `F4.17` / ADR 0125 Q9 — the shared key of one `F3.47` evaluate-now bucket. */
export function evaluateThrottleKey(bucket: string): string {
  return `rl:v1:evaluate:${safeSubject(bucket)}`;
}

/** The fixed window `now` falls in, and the milliseconds until it ends. */
export function fixedWindow(now: number, windowMs: number): { index: number; resetMs: number } {
  const index = Math.floor(now / windowMs);
  return { index, resetMs: (index + 1) * windowMs - now };
}

/**
 * Normalises a client address into the subject Stage 1 counts against.
 *
 * - An IPv4-mapped IPv6 address (`::ffff:203.0.113.7`) is the IPv4 address.
 * - An IPv6 address is reduced to its /64: one host typically owns a whole
 *   /64, so counting per address would let it rotate through 2^64 buckets.
 * - Anything unparseable keys one shared `unknown` bucket rather than a bucket
 *   per arbitrary string.
 */
export function ipSubject(address: string | undefined): string {
  if (!address) {
    return "unknown";
  }
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  if (mapped?.[1] && isIPv4(mapped[1])) {
    return mapped[1];
  }
  if (isIPv4(trimmed)) {
    return trimmed;
  }
  const zoneless = trimmed.replace(/%.*$/, "");
  if (isIPv6(zoneless)) {
    return `${expandIpv6(zoneless).slice(0, 4).join(":")}::/64`;
  }
  return "unknown";
}

function expandIpv6(address: string): string[] {
  const [head = "", tail] = address.toLowerCase().split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = [...headParts, ...Array<string>(Math.max(missing, 0)).fill("0"), ...tailParts];
  return parts.map((part) => (part.replace(/^0+(?=.)/, "") || "0"));
}

/**
 * Decision 8 — the client address after trusting `hops` proxies, with the
 * same rule Express applies for `app.set('trust proxy', n)` (`proxy-addr` with
 * a hop count): the candidate list is the socket peer followed by the
 * `X-Forwarded-For` entries from right to left, and the answer is the entry
 * `hops` places in.
 *
 * Reading from the right is what makes it spoof-resistant: a client can
 * prepend anything to `X-Forwarded-For`, but the proxies it passes through
 * append, so the rightmost `hops` entries are always theirs.
 *
 * **One deliberate difference from Express** (security review, M2): when the
 * chain has fewer than `hops` forwarded entries, Express falls back to the
 * leftmost — an entry the client wrote, if the request reached the API by a
 * path with fewer proxies than configured. This returns the socket peer
 * instead, so a short chain can neither pick its own bucket nor aim at a
 * victim's; every such request shares the peer's bucket. Both HTTP (Stage 1)
 * and the Socket.IO handshake call this, so the two agree.
 */
export function clientAddress(
  socketAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  hops: number,
): string | undefined {
  if (hops <= 0) {
    return socketAddress;
  }
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor ?? "";
  const forwarded = header
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .reverse();
  if (forwarded.length < hops) {
    return socketAddress;
  }
  return forwarded[hops - 1];
}
