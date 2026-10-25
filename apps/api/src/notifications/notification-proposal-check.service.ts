import { BadRequestException, Inject, Injectable } from "@nestjs/common";

import { type JwtPayload, type NotificationRecipient, WEBHOOK_URL_TYPED_ON_CONFIRM } from "@bms/shared";

import { ChannelWritesService, type RuleChannelPreviewRow } from "./channel-writes.service";
import { ChannelsService } from "./channels.service";
import { EscalationProfilesService } from "./escalation-profiles.service";
import type { NotificationChannelRow } from "./notification-transport";

/** What the propose tool asks: one notification entry's proposal, already resolved to its organization. */
export type NotificationProposalCheckInput = {
  readonly entryId: string;
  readonly params: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
  readonly organizationId: string;
  readonly user: JwtPayload;
};

export type NotificationProposalCheckResult = {
  /** Appended to the model-facing summary: names and counts only, never an address (D5). */
  readonly note: string;
  /** The card-only list: every channel the change reaches, with each address or URL in full (D5). */
  readonly recipients: NotificationRecipient[];
};

/** Q3, Q13: the sentence a fleet-wide channel is refused with. */
export const FLEET_CHANNEL_REFUSAL = "Fleet-wide channels are managed on the Channels page";

/** The entries whose target is one channel row, the path parameter `id`. */
const CHANNEL_ROW_ENTRIES: ReadonlySet<string> = new Set([
  "notificationChannel.update",
  "notificationChannel.deactivate",
  "notificationChannel.reactivate",
  "notificationChannel.test",
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** A channel's targets: an email channel's `config.to`, a webhook's `config.url`, as stored. */
function storedTargets(kind: string, config: Readonly<Record<string, unknown>>): string[] {
  if (kind === "webhook") return typeof config.url === "string" ? [config.url] : [];
  return strings(config.to);
}

/**
 * The targets a create or update will store: the body's `config` for an email
 * channel, and the typed-on-Confirm marker for a webhook (Q12: the model never
 * proposes a URL; the user types it on the card).
 */
function proposedTargets(kind: string, config: Readonly<Record<string, unknown>>): string[] {
  return kind === "webhook" ? [WEBHOOK_URL_TYPED_ON_CONFIRM] : strings(config.to);
}

function recipientOf(channel: Pick<NotificationChannelRow, "id" | "name" | "kind" | "config">): NotificationRecipient {
  return { channelId: channel.id, name: channel.name, kind: channel.kind, targets: storedTargets(channel.kind, channel.config) };
}

const targetCount = (recipients: readonly NotificationRecipient[]): number =>
  recipients.reduce((sum, recipient) => sum + recipient.targets.length, 0);

/**
 * `F4.279` (ADR 0099 Amendment 8 D2, D5; owner rulings Q3, Q13) — the check a
 * notification proposal runs before its card is stored, the
 * `RuleProposalCheckService` shape.
 *
 * It resolves every channel the proposal names — the path's channel, a
 * ladder's `steps[].channelIds`, and for a severity map the ladders of the
 * profiles it maps — through `ChannelsService.loadById`, the route's own gate
 * (a 403 is the refusal, and its sentence is the route's). A rule's
 * `channelIds` are read through `ChannelWritesService.previewRuleChannels`
 * instead, because `setRuleChannels` has no manage gate of its own.
 * A fleet-wide channel (`organizationId === null`) is refused with
 * {@link FLEET_CHANNEL_REFUSAL}, and a channel of another organization with the
 * pairing sentence `setRuleChannels` and the profile service use.
 *
 * It builds the card-only `recipients` list, every address and URL in full,
 * and a `note` with names and counts only, which the propose tool appends to
 * the model-facing summary. **It reads only; it writes nothing** — its three
 * services are used for `loadById`, `list` and `previewRuleChannels` alone.
 *
 * In the API-only `NotificationsModule`, exported for `CopilotModule`.
 */
@Injectable()
export class NotificationProposalCheckService {
  constructor(
    @Inject(ChannelsService) private readonly channels: Pick<ChannelsService, "loadById">,
    @Inject(EscalationProfilesService) private readonly profiles: Pick<EscalationProfilesService, "list">,
    @Inject(ChannelWritesService) private readonly writes: Pick<ChannelWritesService, "previewRuleChannels">,
  ) {}

  async check(input: NotificationProposalCheckInput): Promise<NotificationProposalCheckResult> {
    const { entryId, params, body, organizationId, user } = input;

    if (entryId === "notificationChannel.create") {
      const kind = typeof body.kind === "string" ? body.kind : "email";
      const config = isObject(body.config) ? body.config : {};
      const recipients = [{ channelId: null, name: typeof body.name === "string" ? body.name : "", kind, targets: proposedTargets(kind, config) }];
      return { note: `Recipients: ${targetCount(recipients)}.`, recipients };
    }

    if (CHANNEL_ROW_ENTRIES.has(entryId)) {
      const [channel] = await this.load(user, [params.id as string], organizationId, "channel");
      if (channel === undefined) throw new BadRequestException(`Channel does not exist: ${params.id ?? ""}`);
      let recipient = recipientOf(channel);
      if (entryId === "notificationChannel.update") {
        const kind = typeof body.kind === "string" ? body.kind : channel.kind;
        const config = isObject(body.config) ? body.config : undefined;
        const kindChanged = kind !== channel.kind;
        recipient = {
          channelId: channel.id,
          name: typeof body.name === "string" ? body.name : channel.name,
          kind,
          targets: config !== undefined || kindChanged ? proposedTargets(kind, config ?? {}) : recipient.targets,
        };
      }
      return { note: `Recipients: ${recipient.targets.length}.`, recipients: [recipient] };
    }

    if (entryId === "rule.notifications.set") {
      return this.checkRuleChannels(user, params.id as string, strings(body.channelIds), organizationId);
    }

    let channelIds: string[] = [];
    let pairing = "rule";
    if (entryId === "escalationProfile.create" || entryId === "escalationProfile.update") {
      pairing = "profile";
      channelIds = Array.isArray(body.steps)
        ? body.steps.flatMap((step) => (isObject(step) ? strings(step.channelIds) : []))
        : [];
    } else if (entryId === "escalationDefaults.set" || entryId === "escalationDefaults.clear") {
      pairing = "profile";
      channelIds = await this.mappedChannelIds(user, body, organizationId);
    }
    const unique = [...new Set(channelIds)];
    const found = await this.load(user, unique, organizationId, pairing);
    const missing = unique.filter((id) => !found.some((channel) => channel.id === id));
    if (missing.length > 0) throw new BadRequestException(`Channel does not exist: ${missing.join(", ")}`);
    const recipients = found.map(recipientOf);
    if (recipients.length === 0) return { note: "", recipients };
    return { note: `Channels: ${recipients.length}; recipients: ${targetCount(recipients)}.`, recipients };
  }

  /**
   * `F4.279` review (D2) — a rule's channel set, read as `setRuleChannels` reads it: the named
   * channels with no manage gate (the route has none, so a location or asset-group admin whose
   * rule is in scope is not refused here either), a fleet-wide one refused first (Q3), then one
   * of another organization with the route's pairing sentence. A fleet-wide join the rewrite
   * would drop (a caller with no fence, the global admin) is refused too: the copilot never
   * names one (Q3), so the card could not keep it. The joins the route keeps for the caller are
   * listed on the card as `kept`, and the note says when the rule then notifies nobody.
   */
  private async checkRuleChannels(
    user: JwtPayload,
    ruleId: string,
    channelIds: readonly string[],
    organizationId: string,
  ): Promise<NotificationProposalCheckResult> {
    const unique = [...new Set(channelIds)];
    const preview = await this.writes.previewRuleChannels(user, ruleId, unique);
    if (preview.named.some((channel) => channel.organizationId === null)) throw new BadRequestException(FLEET_CHANNEL_REFUSAL);
    const wrongOrg = preview.named.filter((channel) => channel.organizationId !== organizationId).map((channel) => channel.id);
    if (wrongOrg.length > 0) {
      throw new BadRequestException(`Channel(s) belong to a different organization than this rule: ${wrongOrg.join(", ")}`);
    }
    const missing = unique.filter((id) => !preview.named.some((channel) => channel.id === id));
    if (missing.length > 0) throw new BadRequestException(`Channel does not exist: ${missing.join(", ")}`);
    if (preview.removed.some((channel) => channel.organizationId === null)) throw new BadRequestException(FLEET_CHANNEL_REFUSAL);
    const named = preview.named.map((channel: RuleChannelPreviewRow) => recipientOf(channel));
    const kept = preview.kept.map((channel: RuleChannelPreviewRow) => ({ ...recipientOf(channel), kept: true as const }));
    const notes: string[] = [];
    if (named.length > 0) notes.push(`Channels: ${named.length}; recipients: ${targetCount(named)}.`);
    if (kept.length > 0) notes.push(`Kept outside your scope: ${kept.length} ${kept.length === 1 ? "channel" : "channels"}.`);
    if (named.length + kept.length === 0) notes.push("The rule then notifies nobody.");
    return { note: notes.join(" "), recipients: [...named, ...kept] };
  }

  /**
   * Each channel through the route's gate, in the order named; a fleet-wide one
   * and one of another organization are refused (Q3, the routes' pairing rule).
   */
  private async load(
    user: JwtPayload,
    ids: readonly string[],
    organizationId: string,
    pairing: string,
  ): Promise<NotificationChannelRow[]> {
    const found: NotificationChannelRow[] = [];
    const wrongOrg: string[] = [];
    for (const id of ids) {
      const channel = await this.channels.loadById(user, id);
      if (channel === null) continue;
      if (channel.organizationId === null) throw new BadRequestException(FLEET_CHANNEL_REFUSAL);
      if (channel.organizationId !== organizationId) wrongOrg.push(id);
      found.push(channel);
    }
    if (wrongOrg.length > 0) {
      throw new BadRequestException(
        pairing === "channel"
          ? "Notification channel is outside your access scope"
          : `Channel(s) belong to a different organization than this ${pairing}: ${wrongOrg.join(", ")}`,
      );
    }
    return found;
  }

  /** The channels on the ladders of the profiles a severity map names; an unknown profile is the route's refusal. */
  private async mappedChannelIds(
    user: JwtPayload,
    body: Readonly<Record<string, unknown>>,
    organizationId: string,
  ): Promise<string[]> {
    const items = Array.isArray(body.items) ? body.items.filter(isObject) : [];
    const wanted = [...new Set(items.map((item) => item.profileId).filter((id): id is string => typeof id === "string"))];
    if (wanted.length === 0) return [];
    const profiles = (await this.profiles.list(user)).filter((profile) => profile.organizationId === organizationId);
    const missing = wanted.filter((id) => !profiles.some((profile) => profile.id === id));
    if (missing.length > 0) {
      throw new BadRequestException(`Profile(s) do not exist in this organization: ${missing.join(", ")}`);
    }
    return profiles
      .filter((profile) => wanted.includes(profile.id))
      .flatMap((profile) => profile.steps.flatMap((step) => step.channelIds));
  }
}
