import { Inject, Injectable } from "@nestjs/common";

import type { JwtPayload, NotificationRecipient } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import type { NotificationChannelRow } from "../notifications/notification-transport";
import { ReportFilesService } from "./report-files.service";
import { ReportSchedulesService } from "./report-schedules.service";

/** What the propose tool asks: one report entry's proposal, already resolved to its organization. */
export type ReportProposalCheckInput = {
  readonly entryId: string;
  readonly params: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
  readonly organizationId: string;
  readonly user: JwtPayload;
};

export type ReportProposalCheckResult = {
  /** Appended to the model-facing summary: the channel name and the recipient count only, never an address (D5). */
  readonly note: string;
  /** The card-only list: the email channel the schedule delivers to, with every address in full (D5). */
  readonly recipients: NotificationRecipient[];
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function recipientOf(channel: Pick<NotificationChannelRow, "id" | "name" | "kind" | "config">): NotificationRecipient {
  return { channelId: channel.id, name: channel.name, kind: channel.kind, targets: strings(channel.config.to) };
}

const plural = (count: number, one: string): string => `${count} ${one}${count === 1 ? "" : "s"}`;

/**
 * `F4.280` (ADR 0099 Amendment 8 D2, D4, D5, Q14; owner rulings Q4, Q5) — the
 * check a report proposal runs before its card is stored, the
 * `NotificationProposalCheckService` shape. It reads only.
 *
 * A schedule create or update runs the route's own write checks,
 * `ReportSchedulesService.checkWriteScope` (the locations in the organization
 * and in the writable set, `[]` for organization-level rights only, the
 * channel through `ChannelsService.loadById`, email, same organization). A
 * refusal is the route's `HttpException`, and its sentence reaches the model.
 * The email channel's every address is the card-only `recipients`; the note
 * names the channel and the count only.
 *
 * Q4: an update whose body omits `channelId` lists no recipients and says the
 * delivery is unchanged — the stored channel is not read for the card, because
 * the route does not read it either and its gate must not refuse a PATCH the
 * route admits (D2's "nothing more"). The one exception (owner ruling
 * 2026-10-24): an update that sets `enabled: true` and omits `channelId` reads
 * the stored channel once, through `ReportSchedulesService.storedEmailChannel`
 * (the route's row read, then the channel under the schedule's organization,
 * not the channel route's gate), and lists its recipients as a `channelId`
 * body does, so the admin sees who gets the emails again. No stored channel,
 * or one gone, foreign or not email, keeps "unchanged".
 *
 * The on-demand save runs `ReportFilesService.previewSave`: the storage gate
 * (503), the location stamp (403) and the cap pre-check (409), with no render
 * and no storage call (Q14: the file renders inside the Confirm request).
 * `F4.290`: the body's `locationIds` reach it, so a named site outside the
 * organization or the writable set is the route's 400 or 403, and the note
 * names the stamp the route will write.
 *
 * {@link startsEmail} is the D4 input (Q5): a `channelId` string, or
 * `enabled: true` on a schedule whose stored channel is set (re-enabling starts
 * the emails again) and whose body does not clear it.
 */
@Injectable()
export class ReportProposalCheckService {
  constructor(
    @Inject(ReportSchedulesService)
    private readonly schedules: Pick<ReportSchedulesService, "checkWriteScope" | "get" | "storedEmailChannel">,
    @Inject(ReportFilesService) private readonly files: Pick<ReportFilesService, "previewSave">,
    @Inject(AccessControlService) private readonly access: Pick<AccessControlService, "writableLocationIds">,
  ) {}

  async check(input: ReportProposalCheckInput): Promise<ReportProposalCheckResult> {
    if (input.entryId === "reportFile.save") {
      // `F4.290`: a named site list is checked and stamped as the route does it.
      const named = Array.isArray(input.body.locationIds) ? strings(input.body.locationIds) : undefined;
      const { locationIds } = await this.files.previewSave(input.user, input.organizationId, named);
      const stamp = locationIds.length === 0 ? "the whole organization" : plural(locationIds.length, "location");
      return { note: `Rendered on Confirm; stamped to ${stamp}.`, recipients: [] };
    }
    const body = input.body;
    const locationIds = Array.isArray(body.locationIds) ? strings(body.locationIds) : undefined;
    const channelId = typeof body.channelId === "string" || body.channelId === null ? body.channelId : undefined;
    const writable = await this.access.writableLocationIds(input.user);
    const named = await this.schedules.checkWriteScope(input.user, input.organizationId, locationIds, channelId, writable);
    const unchanged = input.entryId === "reportSchedule.update" && channelId === undefined;
    const channel =
      named ?? (unchanged && body.enabled === true ? await this.schedules.storedEmailChannel(input.user, input.params.id as string) : null);
    if (channel !== null) {
      const recipient = recipientOf(channel);
      return {
        note: `Email delivery: channel "${channel.name}", ${plural(recipient.targets.length, "recipient")}, on every run with no later Confirm.`,
        recipients: [recipient],
      };
    }
    return { note: unchanged ? "Email delivery: unchanged." : "Email delivery: none.", recipients: [] };
  }

  /** D4 (Q5): whether the proposal makes the schedule send email. A read refusal is the route's (the caller returns it). */
  async startsEmail(input: Omit<ReportProposalCheckInput, "organizationId">): Promise<boolean> {
    if (input.entryId !== "reportSchedule.create" && input.entryId !== "reportSchedule.update") return false;
    if (typeof input.body.channelId === "string") return true;
    if (input.entryId !== "reportSchedule.update" || input.body.enabled !== true || input.body.channelId !== undefined) return false;
    const stored = await this.schedules.get(input.user, input.params.id as string);
    return stored.channelId !== null;
  }
}
