import { EmailTransport, readRecipients, type MailSender } from "./email.transport";
import type { NotificationChannelRow, NotificationMessage } from "./notification-transport";
import { buildConfig } from "./notifications.config";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const RECIPIENT = "control.room@ion-exchange.example";
const SECOND_RECIPIENT = "duty.engineer@ion-exchange.example";
const SMTP_PASSWORD = "smtp-password-never-log-this";

const CONFIGURED = {
  SMTP_HOST: "mailpit",
  SMTP_PORT: "1025",
  SMTP_USER: "trinetra-smtp-user",
  SMTP_PASSWORD,
  SMTP_FROM: "trinetra@ion-exchange.example",
};

function channel(overrides: Partial<NotificationChannelRow> = {}): NotificationChannelRow {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    organizationId: "12121212-1212-1212-1212-121212121212",
    code: "ops-email",
    name: "Operations email",
    kind: "email",
    config: { to: [RECIPIENT, SECOND_RECIPIENT] },
    secret: null,
    secretState: "none",
    enabled: true,
    ...overrides,
  };
}

function message(row: NotificationChannelRow = channel()): NotificationMessage {
  return {
    subject: "Alarm: UPS-1 battery temperature",
    body: "UPS-1 battery temperature is 48C, above the 45C threshold.",
    ruleId: "11111111-1111-1111-1111-111111111111",
    ruleCode: "UPS-BATT-TEMP",
    alarmId: "22222222-2222-2222-2222-222222222222",
    severity: "critical",
    channel: row,
  };
}

type SentMail = { from: string; to: string[]; subject: string; text: string };

function fakeSender(fail?: Error): { sender: MailSender; sent: SentMail[] } {
  const sent: SentMail[] = [];
  return {
    sent,
    sender: {
      sendMail: (options: SentMail) => {
        if (fail) return Promise.reject(fail);
        sent.push(options);
        return Promise.resolve({ messageId: "fake" });
      },
    },
  };
}

/**
 * `F3.8` U5 — `EmailTransport` against a fake sender.
 *
 * No socket is opened and no inbox is required to build, review or merge
 * `F3.8` (ADR 0041 decision 2).
 */
export async function runEmailTransportTests(): Promise<void> {
  // --- the happy path ------------------------------------------------------
  {
    const { sender, sent } = fakeSender();
    const transport = new EmailTransport({ sender, config: buildConfig(CONFIGURED) });
    const result = await transport.send(message());
    assert(result.status === "sent", `a successful send must be sent, got ${result.status}`);
    assert(sent.length === 1, `expected one mail, got ${sent.length}`);
    assert(
      sent[0]?.to.join(",") === `${RECIPIENT},${SECOND_RECIPIENT}`,
      "both configured recipients must receive it",
    );
    assert(
      sent[0]?.from === "trinetra@ion-exchange.example",
      `SMTP_FROM must be the sender, got ${String(sent[0]?.from)}`,
    );
  }

  // --- unconfigured --------------------------------------------------------
  //
  // Decision 5: an unconfigured transport is a recorded skip, never an
  // exception and never silence.
  {
    const { sender, sent } = fakeSender();
    const transport = new EmailTransport({ sender, config: buildConfig({}) });
    const result = await transport.send(message());
    assert(
      result.status === "skipped_unconfigured",
      `no SMTP_HOST must skip, got ${result.status}`,
    );
    assert(sent.length === 0, "nothing may be sent without a configured host");
  }

  // --- a channel with no recipients ---------------------------------------
  {
    const { sender, sent } = fakeSender();
    const transport = new EmailTransport({ sender, config: buildConfig(CONFIGURED) });
    for (const config of [{}, { to: [] }, { to: "" }, { to: ["   "] }, { to: 42 }]) {
      const result = await transport.send(message(channel({ config })));
      assert(
        result.status === "skipped_unconfigured",
        `config ${JSON.stringify(config)} must skip, got ${result.status}`,
      );
    }
    assert(sent.length === 0, "a channel with no usable recipient sends nothing");
  }

  // --- a failure carries no address and no password ------------------------
  //
  // The error string is stored in notification_deliveries.error, returned by
  // GET /notifications/deliveries and rendered in the browser (§9.6).
  {
    const leaky = new Error(
      `550 5.1.1 <${RECIPIENT}>: recipient rejected (auth user trinetra-smtp-user pass ${SMTP_PASSWORD})`,
    );
    const { sender } = fakeSender(leaky);
    const transport = new EmailTransport({ sender, config: buildConfig(CONFIGURED) });
    const result = await transport.send(message());
    assert(result.status === "failed", `a rejected send must be failed, got ${result.status}`);
    const error = result.error ?? "";
    assert(!error.includes(RECIPIENT), `the error leaked a recipient address: ${error}`);
    assert(!error.includes(SMTP_PASSWORD), `the error leaked the SMTP password: ${error}`);
    assert(
      !error.includes("trinetra-smtp-user"),
      `the error leaked the SMTP user: ${error}`,
    );
    assert(error.includes("550"), `the error should still say what went wrong: ${error}`);
  }

  // A very long failure is bounded — some servers reply with a wall of text.
  {
    const { sender } = fakeSender(new Error("x".repeat(5_000)));
    const transport = new EmailTransport({ sender, config: buildConfig(CONFIGURED) });
    const result = await transport.send(message());
    assert(
      (result.error ?? "").length < 700,
      `the error must be bounded, got ${(result.error ?? "").length} characters`,
    );
  }

  // --- the recipient reader -----------------------------------------------
  assert(readRecipients({ to: [RECIPIENT] }).length === 1, "an array of one");
  assert(readRecipients({ to: RECIPIENT }).length === 1, "a bare string is tolerated");
  assert(readRecipients({ to: [" a@b.c ", "", null, 7] }).join("") === "a@b.c", "trimmed and filtered");
  assert(readRecipients({}).length === 0, "no `to` key at all");
}
