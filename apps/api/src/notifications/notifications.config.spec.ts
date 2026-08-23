import { buildConfig } from "./notifications.config";
import { LogTransport } from "./log.transport";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F3.8` U3 — the environment reading and the stand-in transport.
 *
 * Assertions live here; `notifications.config.test.ts` is the Vitest entry
 * point (ADR 0014). `buildConfig` takes an environment object rather than
 * reading `process.env`, so none of this mutates the real environment.
 */
export function runNotificationsConfigTests(): void {
  // --- SMTP ---------------------------------------------------------------
  //
  // Decisions 5 and 12: no host means no EmailTransport, which means a
  // recorded skip and a readiness banner. A default host would look configured
  // while sending alarm text at whatever listens on that port.
  assert(buildConfig({}).smtp === null, "an empty environment must report SMTP unconfigured");
  assert(
    buildConfig({ SMTP_PORT: "2525", SMTP_FROM: "a@b.c" }).smtp === null,
    "SMTP_PORT and SMTP_FROM without SMTP_HOST must still be unconfigured — " +
      "a partial configuration is not a configuration",
  );

  const smtp = buildConfig({ SMTP_HOST: "mailpit" }).smtp;
  assert(smtp !== null, "SMTP_HOST alone must configure SMTP");
  assert(smtp?.port === 587, `default port must be 587, got ${String(smtp?.port)}`);
  assert(smtp?.secure === false, "secure must default to false");
  assert(
    smtp?.from === "trinetra@localhost",
    `default from must be trinetra@localhost, got ${String(smtp?.from)}`,
  );
  assert(
    buildConfig({ SMTP_HOST: "mailpit", SMTP_SECURE: "true" }).smtp?.secure === true,
    "SMTP_SECURE=true must enable TLS",
  );
  assert(
    buildConfig({ SMTP_HOST: "mailpit", SMTP_PORT: "2525" }).smtp?.port === 2525,
    "SMTP_PORT must be honoured when it parses",
  );
  // A typo must not become NaN: nodemailer would then connect nowhere useful
  // and the failure would be a socket error rather than a configuration one.
  assert(
    buildConfig({ SMTP_HOST: "mailpit", SMTP_PORT: "not-a-port" }).smtp?.port === 587,
    "an unparseable SMTP_PORT must fall back to the default rather than NaN",
  );

  // --- the insecure-webhook escape hatch ----------------------------------
  //
  // Only the exact string "true" opts in. This disables the https-only rule in
  // WebhookTransport (decision 6), so a copied .env line must not be able to
  // half-disable it: an unrecognised value leaves the restriction ON.
  assert(
    buildConfig({}).webhookAllowInsecure === false,
    "insecure webhooks must be off by default",
  );
  for (const value of ["1", "yes", "TRUE", "True", "on", ""]) {
    assert(
      buildConfig({ NOTIFY_WEBHOOK_ALLOW_INSECURE: value }).webhookAllowInsecure === false,
      `NOTIFY_WEBHOOK_ALLOW_INSECURE=${value} must NOT opt in — only the exact string "true" does`,
    );
  }
  assert(
    buildConfig({ NOTIFY_WEBHOOK_ALLOW_INSECURE: "true" }).webhookAllowInsecure === true,
    'NOTIFY_WEBHOOK_ALLOW_INSECURE="true" must opt in',
  );

  // --- the hourly ceiling --------------------------------------------------
  assert(buildConfig({}).ratePerHour === 60, "the default ceiling is 60 per channel per hour");
  assert(
    buildConfig({ NOTIFY_RATE_LIMIT_PER_HOUR: "5" }).ratePerHour === 5,
    "NOTIFY_RATE_LIMIT_PER_HOUR must be honoured",
  );
  // NaN compares false against every ceiling, so a typo here would silently
  // remove the storm control rather than restore the default.
  for (const value of ["", "abc", "0", "-3"]) {
    assert(
      buildConfig({ NOTIFY_RATE_LIMIT_PER_HOUR: value }).ratePerHour === 60,
      `NOTIFY_RATE_LIMIT_PER_HOUR=${value} must fall back to 60, never NaN or a non-limit`,
    );
  }
}

/** `F3.8` U3 — the stand-in transport reports a skip and says nothing private. */
export async function runLogTransportTests(): Promise<void> {
  const lines: string[] = [];
  const transport = new LogTransport();
  // Capture what reaches the logger without asserting on pino's transport.
  const logger = (transport as unknown as { logger: { warn: (m: string) => void } }).logger;
  const original = logger.warn.bind(logger);
  logger.warn = (m: string) => {
    lines.push(m);
  };

  try {
    const result = await transport.send({
      subject: "Alarm: UPS-1 battery temperature",
      body: "UPS-1 battery temperature is 48C, above the 45C threshold.",
      ruleId: "11111111-1111-1111-1111-111111111111",
      ruleCode: "UPS-BATT-TEMP",
      alarmId: "22222222-2222-2222-2222-222222222222",
      severity: "critical",
      channel: {
        id: "33333333-3333-3333-3333-333333333333",
        code: "ops-email",
        name: "Operations email",
        kind: "email",
        config: { recipients: ["control.room@ion-exchange.example"] },
        secret: "super-secret-hmac-key",
        secretState: "ready",
        enabled: true,
      },
    });

    // It reports a skip, not a send. `sent` here would make the deliveries view
    // claim somebody was told when nobody was — the question the ledger exists
    // to answer (decision 4).
    assert(
      result.status === "skipped_unconfigured",
      `the stand-in must report skipped_unconfigured, got ${result.status}`,
    );
    assert(result.error === null, "a stand-in skip is not an error");

    assert(lines.length === 1, `expected exactly one log line, got ${lines.length}`);
    const line = lines[0] ?? "";

    // §9.6: identifiers yes, content and credentials never.
    assert(line.includes("ops-email"), "the line must name the channel so it can be found");
    assert(line.includes("UPS-BATT-TEMP"), "the line must name the rule");
    for (const forbidden of [
      "control.room@ion-exchange.example",
      "super-secret-hmac-key",
      "battery temperature is 48C",
      "Alarm: UPS-1",
      "recipients",
    ]) {
      assert(
        !line.includes(forbidden),
        `the log line leaked ${forbidden} — a transport logs identifiers, never config, ` +
          "recipients, secrets, subject or body (AGENTS.md §9.6)",
      );
    }
  } finally {
    logger.warn = original;
  }
}
