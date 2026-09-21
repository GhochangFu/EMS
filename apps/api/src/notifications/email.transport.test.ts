import { describe, it } from "vitest";

import {
  assertAnEmptyAttachmentsArrayMeansNoAttachmentsKey,
  assertAttachmentsReachTheMailerVerbatim,
  assertNoAttachmentsMeansNoAttachmentsKey,
  runEmailTransportTests,
} from "./email.transport.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.8 email transport", () => {
  it("skips when unconfigured and never puts a recipient or password in the error", async () => {
    await runEmailTransportTests();
  });
});

describe("F3.5b — NotificationMessage.attachments reach nodemailer (ADR 0071 decision 10)", () => {
  it("forwards two attachments verbatim as { filename, contentType, content } with the same Buffer instances", async () => {
    await assertAttachmentsReachTheMailerVerbatim();
  });

  it("a message without attachments sends no attachments key", async () => {
    await assertNoAttachmentsMeansNoAttachmentsKey();
  });

  it("an empty attachments array sends no attachments key", async () => {
    await assertAnEmptyAttachmentsArrayMeansNoAttachmentsKey();
  });
});
