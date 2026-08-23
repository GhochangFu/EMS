import {
  assertWebhookTargetAllowed,
  isBlockedAddress,
  WebhookRefusedError,
  type ResolveHost,
} from "./webhook-guard";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A resolver that must never run. Calling it is itself the failure. */
const neverCalled: ResolveHost = () => {
  throw new Error("the guard resolved a host it should have refused first");
};

const resolvesTo =
  (...addresses: string[]): ResolveHost =>
  () =>
    Promise.resolve(addresses);

async function refuses(
  url: string,
  options: { allowInsecure?: boolean; resolve?: ResolveHost },
  expected: RegExp,
  why: string,
): Promise<void> {
  try {
    await assertWebhookTargetAllowed(url, {
      allowInsecure: options.allowInsecure ?? false,
      resolve: options.resolve ?? neverCalled,
    });
  } catch (err) {
    assert(
      err instanceof WebhookRefusedError,
      `${why}: refused with ${String(err)}, which is not a WebhookRefusedError`,
    );
    const message = (err as Error).message;
    assert(
      expected.test(message),
      `${why}: message ${JSON.stringify(message)} does not match ${String(expected)}`,
    );
    return;
  }
  throw new Error(`${why}: the guard ALLOWED ${url}`);
}

async function allows(
  url: string,
  options: { allowInsecure?: boolean; resolve?: ResolveHost },
  why: string,
): Promise<void> {
  await assertWebhookTargetAllowed(url, {
    allowInsecure: options.allowInsecure ?? false,
    resolve: options.resolve ?? neverCalled,
  }).catch((err: unknown) => {
    throw new Error(`${why}: the guard refused with ${String((err as Error).message)}`);
  });
}

/**
 * `F3.8` U4 — every refusal ADR 0041 decision 6 requires, with no socket and
 * no resolver. The `resolve` function is injected, so these cases are exact
 * rather than dependent on what DNS happens to answer today.
 */
export async function runWebhookGuardTests(): Promise<void> {
  // --- scheme --------------------------------------------------------------
  await refuses(
    "http://example.com/hook",
    {},
    /https/i,
    "plain http without the opt-in",
  );
  await allows(
    "http://example.com/hook",
    { allowInsecure: true, resolve: resolvesTo("93.184.216.34") },
    "http with NOTIFY_WEBHOOK_ALLOW_INSECURE=true",
  );
  for (const scheme of ["ftp", "file", "gopher"]) {
    await refuses(`${scheme}://example.com/hook`, {}, /https/i, `the ${scheme} scheme`);
  }
  // The opt-in widens http only. It is not a general "allow anything" switch.
  await refuses(
    "file:///etc/passwd",
    { allowInsecure: true },
    /https/i,
    "file:// even with the insecure opt-in",
  );

  // --- the resolved address ------------------------------------------------
  await refuses(
    "https://hooks.example.com/x",
    { resolve: resolvesTo("127.0.0.1") },
    /private|loopback|link-local/i,
    "a public name resolving to loopback",
  );
  // Decision 6's own example: `grafana` is reachable by name on the Compose
  // network, which is why validating the string at write time is not enough.
  await refuses(
    "https://grafana/api",
    { resolve: resolvesTo("172.18.0.7") },
    /private|loopback|link-local/i,
    "a Compose service name resolving into RFC 1918",
  );
  for (const address of ["169.254.169.254", "fe80::1"]) {
    await refuses(
      "https://h.example.com/x",
      { resolve: resolvesTo(address) },
      /private|loopback|link-local/i,
      `link-local ${address}`,
    );
  }
  // The case a first implementation usually fails: refuse if ANY address is
  // private, not merely the first one.
  await refuses(
    "https://h.example.com/x",
    { resolve: resolvesTo("93.184.216.34", "10.0.0.5") },
    /private|loopback|link-local/i,
    "a host with one public and one private address",
  );
  await allows(
    "https://h.example.com/x",
    { resolve: resolvesTo("93.184.216.34") },
    "a public https target",
  );

  // --- fail closed ---------------------------------------------------------
  //
  // Every one of these would be a bypass if the guard's error handling fell
  // through to "allow".
  await refuses(
    "https://[::1]/hook",
    {},
    /private|loopback|link-local/i,
    "a bracketed IPv6 literal — URL.hostname keeps the brackets, and no resolver takes that form",
  );
  await refuses(
    "https://127.0.0.1/hook",
    {},
    /private|loopback|link-local/i,
    "a bare IPv4 literal",
  );
  await refuses(
    "https://nx.example.com/x",
    {
      resolve: () => Promise.reject(new Error("ENOTFOUND")),
    },
    /resolve/i,
    "a resolver that rejects",
  );
  await refuses(
    "https://empty.example.com/x",
    { resolve: resolvesTo() },
    /resolved to no addresses/i,
    "a resolver that answers with nothing",
  );
  await refuses("not-a-url", {}, /valid URL/i, "an unparseable URL");
  await refuses(
    "https://h.example.com/x",
    { resolve: resolvesTo("not-an-address") },
    /private|loopback|link-local/i,
    "a resolver answering with something that is not an address",
  );

  // --- the message says the host, never the URL ----------------------------
  //
  // A Slack or Teams webhook URL is a bearer credential in its entirety, and
  // this message is stored in notification_deliveries.error, returned by the
  // API and rendered in the browser (§9.6).
  const secretPath = "T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";
  try {
    await assertWebhookTargetAllowed(`https://hooks.internal/services/${secretPath}`, {
      allowInsecure: false,
      resolve: resolvesTo("10.1.2.3"),
    });
    throw new Error("the guard allowed a private target");
  } catch (err) {
    const message = (err as Error).message;
    assert(
      !message.includes(secretPath),
      `the refusal leaked the webhook path: ${message}. The path IS the credential.`,
    );
    assert(
      !message.includes("10.1.2.3"),
      `the refusal leaked the resolved internal address: ${message}`,
    );
    assert(message.includes("hooks.internal"), "the refusal should still name the host");
  }

  // --- the address classifier, directly ------------------------------------
  for (const blocked of [
    "0.0.0.0",
    "10.0.0.5",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    // IPv4-mapped: the same private address in IPv6 notation. An IPv4-only
    // check walks straight past this form.
    "::ffff:10.0.0.1",
    "::ffff:127.0.0.1",
    "fe80::1%eth0",
  ]) {
    assert(isBlockedAddress(blocked), `${blocked} must be blocked`);
  }
  for (const allowed of [
    "93.184.216.34",
    "8.8.8.8",
    "172.32.0.1", // just outside 172.16/12
    "172.15.255.255",
    "100.128.0.1", // just outside 100.64/10
    "192.169.0.1",
    "2606:4700:4700::1111",
    "::ffff:93.184.216.34",
  ]) {
    assert(!isBlockedAddress(allowed), `${allowed} must be allowed`);
  }
}
