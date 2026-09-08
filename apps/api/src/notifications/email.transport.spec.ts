import { until } from "../testing/until";
import { EmailTransport, createSender, readRecipients, type MailSender } from "./email.transport";
import type {
  DeliveryResult,
  NotificationChannelRow,
  NotificationMessage,
} from "./notification-transport";
import { buildConfig, type SmtpConfig } from "./notifications.config";

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
    updatedAt: new Date("2020-01-01T00:00:00.000Z"),
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

  // --- the transport is bounded -------------------------------------------
  //
  // `F3.51` review (Medium). `createSender` passed no timeout, and nodemailer
  // defaults `socketTimeout` to ten minutes. `NotificationsService.dispatch`
  // awaits the transport, `runRaiseRetryPhase` and `runEscalationPhase` await
  // the dispatch inside the sweep, and the sweep is sweep-then-sleep — so one
  // SMTP server that accepts a connection and never answers held that tick,
  // and every later tick, for every tenant. `webhook.transport.ts` has been
  // bounded at 5 s since `F3.8`; this is the same bound on the other socket.
  //
  // Asserted on the options nodemailer records rather than against a real
  // hung server: `Mail.options` is the object `createTransport` was given, so
  // this is the value the SMTP connection is built with, and no socket is
  // opened to read it.
  {
    const smtp = buildConfig(CONFIGURED).smtp;
    assert(smtp !== null, "the fixture configures SMTP");
    const options =
      (createSender(smtp as SmtpConfig) as unknown as { options?: Record<string, unknown> })
        .options ?? {};
    // `dnsTimeout` joined the three after the second review: nodemailer
    // defaults it to 30 s and resolves the host BEFORE the 5 s
    // `connectionTimeout` timer is armed, so a name server that never answers
    // held the send for the whole lifecycle tick with none of the other three
    // ever starting.
    for (const key of [
      "connectionTimeout",
      "greetingTimeout",
      "socketTimeout",
      "dnsTimeout",
    ] as const) {
      const value = options[key];
      assert(
        typeof value === "number" && value > 0,
        `createSender must bound ${key}, got ${JSON.stringify(value)}`,
      );
      // The lifecycle sweep ticks every 30 s (`LIFECYCLE_TICK_MS`). A single
      // bound at or above the tick would let one channel hold a whole tick,
      // which is the defect. Bounded here, not just "set".
      assert(
        (value as number) <= 10_000,
        `${key} must stay well under the 30 s lifecycle tick, got ${String(value)}`,
      );
    }
  }

  // --- a hung server does not hold the sweep -------------------------------
  //
  // `F3.51` second review (Medium). The four constants above bound the
  // CONNECTION, and the docblock that said no single channel can outlive the
  // 30 s tick was false: `socketTimeout` reaches the socket through
  // `socket.setTimeout`, which is an INACTIVITY timer that every byte resets, so
  // a server emitting one byte every 9 s holds `sendMail` for ever, and each
  // `RCPT TO` of a 100-address `config.to` gets its own window. The sweep awaits
  // the dispatch and `runSweepLoop` is sweep-then-sleep, so that one channel
  // holds every phase of every later tick, for every tenant. Only an absolute
  // deadline bounds it, and it bounds the whole exchange rather than each
  // recipient.
  //
  // The deadline is a dependency for the reason `raise-retry.ts` gives for its
  // two parameters: a suite cannot move a constant, and the real bound is
  // twenty seconds of waiting.
  //
  // **Mutation:** drop the race in `send` and `until` throws `UntilTimeoutError`
  // naming this claim, rather than the runner timing out on an anonymous hang.
  {
    const never: MailSender = { sendMail: () => new Promise<never>(() => undefined) };
    const transport = new EmailTransport({
      sender: never,
      config: buildConfig(CONFIGURED),
      deadlineMs: 50,
    });

    let outcome: DeliveryResult | undefined;
    void transport.send(message()).then((result) => {
      outcome = result;
    });
    await until(() => outcome !== undefined, {
      timeoutMs: 1_000,
      label: "a send that never settles is refused by its own deadline",
    });

    assert(outcome?.status === "failed", `a hung send is a failure, got ${String(outcome?.status)}`);
    assert(
      (outcome?.error ?? "").includes("timed out"),
      `the failure says what happened, got ${String(outcome?.error)}`,
    );
    // §9.6, and the same redaction every other failure here gets: the count,
    // never the addresses.
    assert(
      !(outcome?.error ?? "").includes(RECIPIENT),
      `a timed-out send names no recipient, got ${String(outcome?.error)}`,
    );
  }

  // --- the recipient reader -----------------------------------------------
  assert(readRecipients({ to: [RECIPIENT] }).length === 1, "an array of one");
  assert(readRecipients({ to: RECIPIENT }).length === 1, "a bare string is tolerated");
  assert(readRecipients({ to: [" a@b.c ", "", null, 7] }).join("") === "a@b.c", "trimmed and filtered");
  assert(readRecipients({}).length === 0, "no `to` key at all");
}
