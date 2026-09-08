import { Injectable, Logger } from "@nestjs/common";
import { createTransport } from "nodemailer";

import type { NotificationsConfig, SmtpConfig } from "./notifications.config";
import { notificationsConfig } from "./notifications.config";
import type {
  DeliveryResult,
  NotificationMessage,
  NotificationTransport,
} from "./notification-transport";

/**
 * `F3.8` — the email transport (ADR 0041 decisions 2 and 5).
 *
 * **Constructed only when `SMTP_HOST` is set.** With no host there is no
 * transport: the module hands out `LogTransport` instead, the delivery row
 * reads `skipped_unconfigured`, and the readiness route says why. This class
 * therefore never has to represent "configured but not really".
 *
 * Recipients come from `channel.config.to` — an array of addresses an admin
 * saved. They are addresses, not credentials, but they are personal data and
 * they never reach a log line or a delivery `error` (§9.6): the failure text
 * says how many recipients there were, not who they are.
 */

/** What nodemailer's `createTransport(...).sendMail` gives us, narrowed. */
export type MailSender = {
  sendMail(options: {
    from: string;
    to: string[];
    subject: string;
    text: string;
  }): Promise<unknown>;
};

export type EmailTransportDeps = {
  /** Injected in tests so no socket is opened and no inbox is required. */
  sender: MailSender;
  config: NotificationsConfig;
  /**
   * The absolute bound on one `sendMail`, overridden only by a suite — a
   * parameter is what a spec can move, and the real value is twenty seconds of
   * waiting. See {@link SEND_DEADLINE_MS}.
   */
  deadlineMs: number;
};

/**
 * `F3.51` review (Medium) — the four timers nodemailer applies to one SMTP
 * connection, in milliseconds, and what each of them really bounds.
 *
 * Nodemailer's own defaults are two minutes to connect and **ten minutes** of
 * socket inactivity. `NotificationsService.dispatchToChannel` awaits the
 * transport, `runRaiseRetryPhase` and `runEscalationPhase` await the dispatch,
 * and `runSweepLoop` is sweep-then-sleep — so a server that accepts the
 * connection and then says nothing held the whole tick, the escalation phase
 * of that tick, and every phase of every later tick, **for every tenant**.
 * `webhook.transport.ts` has been bounded at 5 s since `F3.8`; these are the
 * same order of bound on the other socket.
 *
 * **The exposure is not new to `F3.51`.** `notifyCleared` and the escalation
 * phase have awaited this transport inside the same sweep since `F3.10`; the
 * raise retry only adds a third phase to the same tick. It is fixed here
 * because `F3.51`'s review is where it was found.
 *
 * **Three of these are not a deadline, and the second review's finding is that
 * this docblock used to claim they were.** Measured against nodemailer 6.10.1
 * as installed:
 *
 * - `connectionTimeout` and `greetingTimeout` bound two phases of opening the
 *   connection, and nothing after them.
 * - `dnsTimeout` was UNSET and defaults to 30 s — as long as the whole
 *   lifecycle tick — and resolution happens *before* the `connectionTimeout`
 *   timer is armed, so a name server that never answers was never bounded by
 *   any of the other three. It is set here for exactly that reason.
 * - `socketTimeout` reaches the socket through `socket.setTimeout`, which is an
 *   **inactivity** timer: every byte received resets it. A server emitting one
 *   byte every 9 s never trips it and holds the send indefinitely, and
 *   `readRecipients` caps nothing, so each `RCPT TO` of a long `config.to` gets
 *   its own fresh window.
 *
 * {@link SEND_DEADLINE_MS} is the bound that does not have that shape.
 */
const CONNECTION_TIMEOUT_MS = 5_000;
const GREETING_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 10_000;
const DNS_TIMEOUT_MS = 5_000;

/**
 * The absolute bound on one `sendMail`, in milliseconds — wall clock from the
 * call to the answer, whatever the server does in between.
 *
 * This is the only one of the five that bounds the SWEEP. It covers name
 * resolution, the connection, the greeting, every `RCPT TO` of a long recipient
 * list and the `DATA` exchange together, so no single channel can outlive the
 * 30 s `LIFECYCLE_TICK_MS` — which is what the four constants above were
 * wrongly said to guarantee. A recipient cap would not have been needed even
 * had one been added: the deadline bounds the whole exchange, not each address.
 *
 * **It bounds the caller, not the socket, and that distinction is the honest
 * part.** The abandoned `sendMail` is not cancelled — nodemailer has no
 * per-message abort — so a dribbling server keeps that socket until one of its
 * own timers fires, which the same dribble can defer. What the sweep gets back
 * is its tick; what a hostile server keeps is one socket per send it can hold.
 * Bounding that too would mean closing the transport under the send, which
 * would take a pooled connection out from under any concurrent one.
 *
 * **One send, still, not one tick.** `dispatchToChannels` loops its channels
 * sequentially, so N email channels serialise into N × this.
 */
const SEND_DEADLINE_MS = 20_000;

/** The one place nodemailer is constructed from configuration. */
export function createSender(smtp: SmtpConfig): MailSender {
  return createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    // See the four constants above: without them nodemailer waits ten minutes
    // on a silent socket and thirty seconds on a silent name server, inside a
    // sweep that cannot start its next tick until this call returns.
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    dnsTimeout: DNS_TIMEOUT_MS,
    // Only when a user is configured. An `auth` block with an undefined user
    // makes nodemailer attempt AUTH against servers that do not want it —
    // Mailpit among them.
    ...(smtp.user === undefined || smtp.user === ""
      ? {}
      : { auth: { user: smtp.user, pass: smtp.password ?? "" } }),
  });
}

@Injectable()
export class EmailTransport implements NotificationTransport {
  readonly kind = "email";

  private readonly logger = new Logger(EmailTransport.name);
  private readonly config: NotificationsConfig;
  private readonly deadlineMs: number;
  private sender: MailSender | null;

  constructor(deps: Partial<EmailTransportDeps> = {}) {
    this.config = deps.config ?? notificationsConfig;
    this.deadlineMs = deps.deadlineMs ?? SEND_DEADLINE_MS;
    this.sender =
      deps.sender ?? (this.config.smtp === null ? null : createSender(this.config.smtp));
  }

  async send(message: NotificationMessage): Promise<DeliveryResult> {
    const smtp = this.config.smtp;
    if (smtp === null || this.sender === null) {
      // Defensive: the module should never construct this transport without a
      // host. If it ever does, the answer is still a recorded skip, never a
      // throw inside a fire-and-forget dispatch (decision 1).
      return { status: "skipped_unconfigured", error: "SMTP_HOST is not set" };
    }

    const to = readRecipients(message.channel.config);
    if (to.length === 0) {
      return { status: "skipped_unconfigured", error: "channel has no recipients configured" };
    }

    try {
      await withDeadline(
        this.sender.sendMail({
          from: smtp.from,
          to,
          subject: message.subject,
          text: message.body,
        }),
        this.deadlineMs,
      );
      return { status: "sent", error: null };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Scrubbed twice over: the recipients are replaced by a count, and the
      // SMTP password is removed if the server or the library echoed it back
      // in the error text. This string is stored in
      // `notification_deliveries.error` and rendered in the browser.
      const safe = redact(reason, to, smtp);
      this.logger.warn(
        `email failed for channel=${message.channel.code} recipients=${to.length}: ${safe}`,
      );
      return { status: "failed", error: `email send failed: ${safe}` };
    }
  }
}

/**
 * Resolves with `pending`, or rejects at `ms` whatever `pending` is doing —
 * {@link SEND_DEADLINE_MS}'s enforcement, and `webhook.transport.ts`'s shape on
 * a client that takes no signal.
 *
 * `AbortSignal.timeout` rather than a bare `setTimeout`: its timer does not
 * hold the event loop open, so a process shutting down between ticks is not
 * kept alive by a send nobody is waiting for any more.
 *
 * The abandoned promise keeps a `catch` of its own. `Promise.race` has already
 * settled by then, so its rejection would otherwise surface as an unhandled
 * rejection minutes later, in a process that moved on several ticks ago.
 */
async function withDeadline<T>(pending: Promise<T>, ms: number): Promise<T> {
  pending.catch(() => undefined);
  const signal = AbortSignal.timeout(ms);
  return Promise.race([
    pending,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new Error(`send timed out after ${ms}ms`)),
        { once: true },
      );
    }),
  ]);
}

/**
 * `config.to` as a list of addresses.
 *
 * Tolerant of a single string as well as an array, because that is the shape a
 * hand-written seed row tends to take, and an admin's typo should produce a
 * recorded skip rather than a crash.
 */
export function readRecipients(config: Record<string, unknown>): string[] {
  const raw = config.to;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return list
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** Removes recipient addresses and the SMTP password from a failure message. */
function redact(reason: string, recipients: string[], smtp: SmtpConfig): string {
  let out = reason;
  for (const address of recipients) {
    out = out.split(address).join("<recipient>");
  }
  if (smtp.password !== undefined && smtp.password !== "") {
    out = out.split(smtp.password).join("<redacted>");
  }
  if (smtp.user !== undefined && smtp.user !== "") {
    out = out.split(smtp.user).join("<smtp-user>");
  }
  return out.length > 500 ? `${out.slice(0, 500)}…` : out;
}
