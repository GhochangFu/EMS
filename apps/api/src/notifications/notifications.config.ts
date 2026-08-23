/**
 * `F3.8` notification configuration — read from the environment once, here
 * (ADR 0041 decision 8).
 *
 * No service body reads `process.env`. `buildConfig` is a pure function of an
 * environment object so a test can enumerate the cases without mutating the
 * real one, and `notificationsConfig` applies it to `process.env` at module
 * load.
 */

export type SmtpConfig = {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
  secure: boolean;
};

export type NotificationsConfig = {
  /** `null` means no SMTP host is configured — see below. */
  smtp: SmtpConfig | null;
  webhookAllowInsecure: boolean;
  ratePerHour: number;
};

/** Nodemailer's own default. Submission, not the legacy SMTP port. */
const DEFAULT_SMTP_PORT = 587;
/** ADR 0041 decision 7, plan D4. Per channel, per hour. */
const DEFAULT_RATE_PER_HOUR = 60;

/**
 * The one place the environment is interpreted.
 *
 * **`smtp` is `null` when `SMTP_HOST` is unset, and that is decisions 5 and 12
 * in one line.** No host means no `EmailTransport`; `LogTransport` stands in,
 * the delivery row reads `skipped_unconfigured`, and the readiness route says
 * so. There is deliberately no default host: a fallback to `localhost` would
 * send real alarm text into whatever happens to be listening on port 25, and
 * would look configured while doing it. ADR 0041 decision 12 keeps Mailpit in
 * its own compose profile for the same reason.
 *
 * **Only the exact string `"true"` opts into insecure webhooks.** `"1"`,
 * `"yes"` and `"TRUE"` do not. The control this disables is the https-only
 * rule in `WebhookTransport` (decision 6), so a copied `.env` line must not be
 * able to half-disable it by accident — an unrecognised value leaves the
 * restriction on, which is the safe direction.
 *
 * An unparseable `NOTIFY_RATE_LIMIT_PER_HOUR` falls back to the default rather
 * than becoming `NaN`. `NaN` compares false against every ceiling, so a typo
 * would silently remove the storm control this exists to provide.
 */
export function buildConfig(env: NodeJS.ProcessEnv): NotificationsConfig {
  const parsedPort = Number(env.SMTP_PORT);
  const parsedRate = Number(env.NOTIFY_RATE_LIMIT_PER_HOUR);

  return {
    smtp: env.SMTP_HOST
      ? {
          host: env.SMTP_HOST,
          port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_SMTP_PORT,
          user: env.SMTP_USER,
          password: env.SMTP_PASSWORD,
          from: env.SMTP_FROM ?? "trinetra@localhost",
          secure: env.SMTP_SECURE === "true",
        }
      : null,
    webhookAllowInsecure: env.NOTIFY_WEBHOOK_ALLOW_INSECURE === "true",
    ratePerHour:
      Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : DEFAULT_RATE_PER_HOUR,
  };
}

export const notificationsConfig: NotificationsConfig = buildConfig(process.env);
