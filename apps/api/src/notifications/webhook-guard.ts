import { isIP } from "node:net";

/**
 * `F3.8` — where a webhook is allowed to POST (ADR 0041 decision 6).
 *
 * A pure predicate, split out of `WebhookTransport` so every refusal is
 * testable without opening a socket. The transport calls this **before**
 * `fetch`; if it throws, no request is made.
 *
 * **Why this cannot be input validation.** A URL is checked here, at send
 * time, after DNS — not when an admin saves the channel. `https://grafana/api`
 * is a perfectly ordinary-looking string that resolves to `172.18.0.7` on the
 * Compose network, so a string check at write time passes it and the request
 * reaches an internal service. The same is true of any public hostname whose
 * A record points inside: only the resolved address answers the question.
 *
 * **The refusal message names the host, never the URL.** A Slack or Teams
 * webhook URL is a bearer credential in its entirety — the path *is* the
 * secret. That message is stored in `notification_deliveries.error`, returned
 * by `GET /notifications/deliveries`, and rendered in the browser, so a URL in
 * it would be a credential in an API response (§9.6).
 */

/** Thrown for every refusal. The transport turns it into a delivery row. */
export class WebhookRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookRefusedError";
  }
}

/** `(host) => addresses`. Injected so the tests need no resolver and no network. */
export type ResolveHost = (host: string) => Promise<readonly string[]>;

export type WebhookGuardOptions = {
  /** `NOTIFY_WEBHOOK_ALLOW_INSECURE === "true"` — a local-development escape hatch. */
  allowInsecure: boolean;
  resolve: ResolveHost;
};

/**
 * Expands an IPv6 address to its eight numeric hextets, or `null` if it is not
 * one. Handles `::` compression and a `%zone` suffix.
 */
function ipv6Hextets(address: string): number[] | null {
  const withoutZone = address.split("%")[0] ?? "";
  if (isIP(withoutZone) !== 6) return null;

  const [head, tail] = withoutZone.includes("::")
    ? withoutZone.split("::")
    : [withoutZone, undefined];
  const headParts = head === "" || head === undefined ? [] : head.split(":");
  const tailParts = tail === "" || tail === undefined ? [] : tail.split(":");
  const missing = 8 - headParts.length - tailParts.length;
  const parts = [...headParts, ...Array<string>(Math.max(missing, 0)).fill("0"), ...tailParts];
  const hextets = parts.map((p) => Number.parseInt(p === "" ? "0" : p, 16));
  return hextets.length === 8 && hextets.every((h) => Number.isFinite(h)) ? hextets : null;
}

/**
 * The IPv4 inside an IPv4-mapped or IPv4-compatible IPv6 address, in dotted
 * form — or `null` when there is none.
 *
 * **This exists because the dotted form is not what arrives.** `new URL()`
 * re-serialises `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]` before any of this
 * code sees it, so a regex over the dotted text matched a string production
 * could never produce, while `::ffff:7f00:1` fell through every IPv6 range
 * test and was ALLOWED — loopback, the whole Compose network and the cloud
 * metadata address with it. The unit tests passed throughout, because they
 * called the classifier with the dotted string directly.
 *
 * So the detection is numeric, on the expanded hextets, where the notation
 * cannot hide it: the first five hextets zero, and the sixth either `ffff`
 * (mapped, RFC 4291 §2.5.5.2) or `0` (the deprecated compatible form). The
 * embedded IPv4 is then classified by the IPv4 rules, so a mapped PUBLIC
 * address still passes — refusing every mapped address would be a different
 * bug.
 *
 * Found by the `F3.8` security review.
 */
function embeddedIpv4(address: string): string | null {
  const hextets = ipv6Hextets(address);
  if (hextets === null) return null;
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = hextets;
  if (h0 !== 0 || h1 !== 0 || h2 !== 0 || h3 !== 0 || h4 !== 0) return null;
  if (h5 !== 0xffff && h5 !== 0) return null;
  // `::` and `::1` are their own cases in the IPv6 branch; treating them as
  // "embedded 0.0.0.0/0.0.0.1" would work but would report them under the
  // wrong rule.
  if (h5 === 0 && h6 === 0 && (h7 === 0 || h7 === 1)) return null;
  return [h6 >> 8, h6 & 0xff, h7 >> 8, h7 & 0xff].join(".");
}

/**
 * `true` for any address a notification must not be sent to: loopback, the
 * RFC 1918 ranges, carrier-grade NAT, link-local (which includes the cloud
 * metadata address `169.254.169.254`), unique-local IPv6, the unspecified
 * address, and multicast.
 *
 * **IPv4-mapped IPv6 is normalised first.** `::ffff:10.0.0.1` is `10.0.0.1`
 * wearing a different notation; an IPv4-only check walks straight past it.
 */
export function isBlockedAddress(address: string): boolean {
  const trimmed = address.trim().toLowerCase();

  // IPv4-mapped and IPv4-compatible IPv6 in DOTTED form (`::ffff:127.0.0.1`),
  // which is what a resolver can hand back.
  const mapped = /^(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(trimmed);
  const candidate = mapped?.[1] ?? embeddedIpv4(trimmed) ?? trimmed;

  if (isIP(candidate) === 4) {
    const octets = candidate.split(".").map((o) => Number.parseInt(o, 10));
    const [a = 0, b = 0] = octets;
    if (a === 0) return true; // "this network" — 0.0.0.0/8
    if (a === 10) return true; // RFC 1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
    if (a === 192 && b === 168) return true; // RFC 1918
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast and reserved, incl. broadcast
    return false;
  }

  const hextets = ipv6Hextets(candidate);
  if (hextets === null) {
    // Not an address this function understands. Callers only pass resolved
    // addresses and literals, so this is a malformed answer — refuse it.
    return true;
  }
  const [first = 0] = hextets;
  if (hextets.every((h) => h === 0)) return true; // ::
  if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1) return true; // ::1
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/**
 * Resolves and vets a webhook target. Returns normally when the POST may
 * proceed; throws {@link WebhookRefusedError} otherwise.
 *
 * **Fails closed.** An unparseable URL, a host that does not resolve, a
 * resolver that rejects, and an empty answer are all refusals. A `catch` that
 * fell through to "allow" would turn every NXDOMAIN into a bypass.
 *
 * **Refuses if ANY resolved address is blocked**, not merely the first. A host
 * with several A records, one of them internal, is the interesting case.
 */
export async function assertWebhookTargetAllowed(
  rawUrl: string,
  options: WebhookGuardOptions,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookRefusedError("webhook url is not a valid URL");
  }

  if (url.protocol !== "https:") {
    if (!(url.protocol === "http:" && options.allowInsecure)) {
      throw new WebhookRefusedError(
        `webhook target must use https (got ${url.protocol.replace(":", "")})`,
      );
    }
  }

  // `URL.hostname` keeps the brackets on an IPv6 literal — `[::1]` — and no
  // resolver accepts that form. Strip them before anything else looks at it.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "") {
    throw new WebhookRefusedError("webhook url has no host");
  }

  // A literal address is already the answer; resolving it would be a no-op at
  // best, and `dns.resolve*` refuses literals outright.
  const addresses = isIP(host) !== 0 ? [host] : await resolveOrRefuse(host, options.resolve);

  const blocked = addresses.filter((address) => isBlockedAddress(address));
  if (blocked.length > 0) {
    // The host, not the URL, and not the addresses either: which internal
    // address a name points at is itself information the operator's endpoint
    // did not ask us to publish.
    throw new WebhookRefusedError(
      `webhook host ${host} resolves to a private, loopback or link-local address`,
    );
  }
}

async function resolveOrRefuse(
  host: string,
  resolve: ResolveHost,
): Promise<readonly string[]> {
  let addresses: readonly string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new WebhookRefusedError(`webhook host ${host} could not be resolved`);
  }
  if (addresses.length === 0) {
    throw new WebhookRefusedError(`webhook host ${host} resolved to no addresses`);
  }
  return addresses;
}
