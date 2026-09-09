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
  /**
   * `F3.52` — how far past its own due instant a due escalation step may be and
   * still be sent (ADR 0041 Amendment 6 §2). In MILLISECONDS: the environment
   * gives minutes and the conversion happens once, here, because
   * `stepIsTooLate` compares against a duration.
   */
  stepMaxLatenessMs: number;
};

/** Nodemailer's own default. Submission, not the legacy SMTP port. */
const DEFAULT_SMTP_PORT = 587;
/** ADR 0041 decision 7, plan D4. Per channel, per hour. */
const DEFAULT_RATE_PER_HOUR = 60;
/**
 * ADR 0041 Amendment 6 §2, ruling 6. Sixty is not arbitrary: it is
 * `isOverHourlyLimit`'s own trailing hour, so a step that could not fit inside
 * one full ceiling window is over budget rather than merely queued.
 */
const DEFAULT_STEP_MAX_LATENESS_MINUTES = 60;

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
 *
 * `NOTIFY_STEP_MAX_LATENESS_MINUTES` is read the same way and for the same
 * reason, and the consequence there is the sharper one: a `NaN` bound compares
 * false against every comparison, so a typo would not relax the escalation
 * cut-off — it would remove it, and every late step would go on sending.
 *
 * **That guard was on the wrong value until the `F3.52` security review.** It
 * tested the parsed MINUTES and then multiplied by `60_000`, so a value at or
 * above roughly `1.5e304` passed `Number.isFinite` and overflowed to
 * `Infinity` in the product — measured: `1e308`, `9e303` and `1.5e304` all
 * produced `Infinity`, and `stepIsTooLate` then returns `false` against every
 * comparison. The `NaN` door was shut while the door beside it, into the same
 * room, stood open. {@link latenessMs} validates the product, which is the
 * value anything downstream actually uses.
 */

/**
 * Minutes from the environment as a millisecond bound, or the default.
 *
 * **Validates the product, not the input.** Both checks are load-bearing and
 * neither implies the other: the input check rejects `NaN`, a negative and a
 * zero, and the product check rejects the overflow a finite input can still
 * reach. A bound of `Infinity` is not a long grace period — it is the cut-off
 * removed, silently and with no log line.
 */
function latenessMs(minutes: number): number {
  const chosen =
    Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_STEP_MAX_LATENESS_MINUTES;
  const ms = chosen * 60_000;
  return Number.isFinite(ms) ? ms : DEFAULT_STEP_MAX_LATENESS_MINUTES * 60_000;
}
export function buildConfig(env: NodeJS.ProcessEnv): NotificationsConfig {
  const parsedPort = Number(env.SMTP_PORT);
  const parsedRate = Number(env.NOTIFY_RATE_LIMIT_PER_HOUR);
  const parsedLateness = Number(env.NOTIFY_STEP_MAX_LATENESS_MINUTES);

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
    stepMaxLatenessMs: latenessMs(parsedLateness),
  };
}

export const notificationsConfig: NotificationsConfig = buildConfig(process.env);

/**
 * `F3.50` (ADR 0057 Amendment 3 ruling Q1) — the instant the environment
 * snapshot above was taken, and the second half of the watermark that decides
 * whether a `skipped_unconfigured` delivery row still answers an event key.
 *
 * **Why a process boundary is the right one, and not a hack.** Two of the five
 * things that produce `skipped_unconfigured` are environment, not
 * configuration: `SMTP_HOST` unset (which is why `transportFor` hands out
 * `LogTransport`) and `CREDENTIAL_ENCRYPTION_KEY` unset or the wrong length
 * (which is why a webhook's `secretState` reads `unreadable`). Neither has a
 * row to stamp. And **readiness cannot flip inside a process**, so process
 * start is not a proxy for a readiness change — it is the only boundary at
 * which one is observable.
 *
 * That stability has two different sources, and the distinction is worth
 * keeping straight. `notificationsConfig` really is frozen: it is
 * `buildConfig(process.env)` evaluated on the line above, and `EmailTransport`
 * goes further and decides its `sender` in its constructor. But
 * `CredentialCryptoService.isConfigured()` reads `process.env` on **every**
 * call — it is not a snapshot. What holds it still is that a running process's
 * environment does not change, not that anything cached it.
 *
 * The cost is bounded and one-directional: one retry, and one row, per stranded
 * key per watermark move.
 *
 * **It lives here, beside the snapshot whose age it records** — the largest
 * single source of `skipped_unconfigured` is `smtp === null`, decided on the
 * line above. It is deliberately NOT a field on `NotificationsConfig`:
 * `buildConfig` is documented as a pure function of an environment object, and
 * a `new Date()` inside it would give every spec that calls it a private
 * watermark. It is deliberately not a Nest provider either — one `Date` needs
 * no token, and importing the constant is what makes it testable.
 *
 * Strictly this is *module* load, not process start. A later import would only
 * move it later, which releases more keys and blocks fewer — the bounded
 * direction.
 */
export const PROCESS_STARTED_AT = new Date();

/**
 * `F3.52` — the escalation cut-off as one importable duration (ADR 0041
 * Amendment 6 §2, ADR 0057 Amendment 7).
 *
 * {@link PROCESS_STARTED_AT}'s pattern: a module-level constant read off the
 * frozen snapshot above, imported by the one caller that needs it rather than
 * threaded through Nest. One number needs no provider token.
 *
 * **Only `runEscalationPhase` imports this.** `stepIsTooLate` takes the bound as
 * a parameter so a suite can move it without touching the environment, which is
 * `raise-retry.ts`'s own argument for `maxAttempts`: a constant a test cannot
 * move is a constant the test has to be written around.
 */
export const STEP_MAX_LATENESS_MS = notificationsConfig.stepMaxLatenessMs;

/**
 * Nest injection token for {@link notificationsConfig}.
 *
 * A token rather than a constructor default: Nest reflects on constructor
 * parameter types, sees `Object` for a plain type alias, and refuses to start
 * because it cannot find a provider for it. A default value does not help — the
 * reflection happens either way.
 */
export const NOTIFICATIONS_CONFIG = Symbol("NOTIFICATIONS_CONFIG");
