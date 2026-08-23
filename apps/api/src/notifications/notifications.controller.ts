import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError, z } from "zod";

import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ChannelsService } from "./channels.service";
import { NOTIFICATIONS_CONFIG, type NotificationsConfig } from "./notifications.config";
import {
  createNotificationChannelBodySchema,
  listDeliveriesQuerySchema,
  updateNotificationChannelBodySchema,
} from "./notifications.schema";
import { NotificationsService } from "./notifications.service";

const idParamSchema = z.string().uuid();

/**
 * `F3.8` — the notifications API (ADR 0041).
 *
 * Channel administration and the delivery ledger are admin-only. **Readiness
 * is not**, deliberately: decision 10 renders it as a banner on the rules
 * surface, and a location-scoped operator editing a rule marked `notify` is
 * exactly the person who must see that no transport is configured. It returns
 * one boolean and one sentence per kind — no host, no port, no credential — so
 * there is nothing an admin-only gate would be protecting.
 */
@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly notifications: NotificationsService,
    private readonly accessControl: AccessControlService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: NotificationsConfig,
  ) {}

  @Get("channels")
  async listChannels(@CurrentUser() user: JwtPayload) {
    this.accessControl.assertAdminRole(user.role);
    return { items: await this.channels.list() };
  }

  @Post("channels")
  @HttpCode(HttpStatus.CREATED)
  async createChannel(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    this.accessControl.assertAdminRole(user.role);
    const dto = parse(createNotificationChannelBodySchema, body);
    return this.channels.create(dto);
  }

  @Patch("channels/:id")
  async updateChannel(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    this.accessControl.assertAdminRole(user.role);
    const channelId = parse(idParamSchema, id);
    const dto = parse(updateNotificationChannelBodySchema, body);
    const updated = await this.channels.update(channelId, dto);
    if (updated === null) throw new NotFoundException("Notification channel not found");
    return updated;
  }

  @Delete("channels/:id")
  @HttpCode(HttpStatus.OK)
  async deleteChannel(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    this.accessControl.assertAdminRole(user.role);
    const channelId = parse(idParamSchema, id);
    const removed = await this.channels.remove(channelId);
    if (!removed) throw new NotFoundException("Notification channel not found");
    return { deleted: true as const };
  }

  /**
   * Sends one real message through the channel's real transport.
   *
   * The point is to move a webhook refusal from 3am to configuration time: the
   * egress guard, the signature and the SMTP connection are all exercised, and
   * the attempt lands in the ledger like any other.
   */
  @Post("channels/:id/test")
  @HttpCode(HttpStatus.OK)
  async testChannel(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    this.accessControl.assertAdminRole(user.role);
    const channelId = parse(idParamSchema, id);
    const channel = await this.channels.loadById(channelId);
    if (channel === null) throw new NotFoundException("Notification channel not found");

    const result = await this.notifications.sendTest(channel);
    return {
      channelId: channel.id,
      channelCode: channel.code,
      status: result.status,
      // The ledger row is written inside `sendTest`; the id is not threaded
      // back out, and inventing one here would be a lie. `null` says "look in
      // the deliveries view", which is where U9 puts it anyway.
      deliveryId: null,
      error: result.error,
    };
  }

  @Get("deliveries")
  async listDeliveries(@CurrentUser() user: JwtPayload, @Query() query: unknown) {
    this.accessControl.assertAdminRole(user.role);
    return this.channels.listDeliveries(parse(listDeliveriesQuerySchema, query));
  }

  /** Authenticated, not admin-only — see the class comment. */
  @Get("readiness")
  readiness() {
    return { items: this.channels.readiness(this.config) };
  }
}

/**
 * `.parse()` with the repo's `ZodError → BadRequestException(flatten())`
 * shape, which every route in `rules.controller.ts` already uses.
 */
function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.flatten());
    }
    throw err;
  }
}
