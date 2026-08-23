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
};

/** The one place nodemailer is constructed from configuration. */
export function createSender(smtp: SmtpConfig): MailSender {
  return createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
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
  private sender: MailSender | null;

  constructor(deps: Partial<EmailTransportDeps> = {}) {
    this.config = deps.config ?? notificationsConfig;
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
      await this.sender.sendMail({
        from: smtp.from,
        to,
        subject: message.subject,
        text: message.body,
      });
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
