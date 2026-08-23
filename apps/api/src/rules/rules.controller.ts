import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  NotFoundException,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError, z } from "zod";

import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { ChannelsService } from "../notifications/channels.service";
import { setRuleNotificationsBodySchema } from "../notifications/notifications.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  listRuleExecutionsQuerySchema,
  ruleDraftBodySchema,
  ruleLifecycleBodySchema,
  rulePreviewBodySchema,
  ruleToggleBodySchema,
  ruleUpdateBodySchema,
} from "./rules.schema";
import { RulesService } from "./rules.service";

const idParamSchema = z.string().uuid();

@Controller("rules")
@UseGuards(JwtAuthGuard)
export class RulesController {
  constructor(
    private readonly rules: RulesService,
    private readonly accessControl: AccessControlService,
    private readonly channels: ChannelsService,
  ) {}

  /**
   * The channels this rule notifies (`F3.8`, ADR 0041, plan D1).
   *
   * Readable by anyone who may read **this** rule — and that is now enforced
   * rather than asserted in a comment. The first version of this handler took
   * no `user` at all, so any authenticated viewer could enumerate the channel
   * ids of any rule id in any organisation.
   */
  @Get(":id/notifications")
  async listRuleNotifications(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    const ruleId = idParamSchema.parse(id);
    await this.rules.assertRuleInScope(ruleId, await this.accessControl.readableAssetIds(user));
    return { channelIds: await this.channels.ruleChannelIds(ruleId) };
  }

  /**
   * Replaces the whole set. PUT, not POST: this is idempotent, and a repeated
   * request must leave the same set rather than a longer one.
   *
   * **Two gates, and §4.7 is explicit that they are additive**: the role may
   * write configuration, AND the rule is inside the caller's asset scope. The
   * first version had only the role check — `configuration` admits
   * `organization_admin`, `location_admin` and `asset_group_admin`, so a
   * location-scoped admin could attach a channel they own to a rule in another
   * location and redirect its alarms to themselves. The plan claimed this route
   * lived here "so the scope check that already guards rule writes guards it
   * too"; nothing wired that in until the compliance review found it.
   */
  @Put(":id/notifications")
  @HttpCode(HttpStatus.OK)
  async setRuleNotifications(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    try {
      const ruleId = idParamSchema.parse(id);
      const dto = setRuleNotificationsBodySchema.parse(body);
      await this.rules.assertRuleInScope(
        ruleId,
        await this.accessControl.readableAssetIds(user),
      );
      const channelIds = await this.channels.setRuleChannels(ruleId, dto.channelIds, user);
      if (channelIds === null) throw new NotFoundException("Rule not found");
      return { channelIds };
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Get()
  async listRules(@CurrentUser() user: JwtPayload) {
    return this.rules.listRules(await this.accessControl.readableAssetIds(user));
  }

  @Get("catalog")
  async listBuilderCatalog(@CurrentUser() user: JwtPayload) {
    return this.rules.getBuilderCatalog(
      await this.accessControl.readableAssetIds(user),
    );
  }

  @Get("executions")
  async listExecutions(@CurrentUser() user: JwtPayload, @Query() query: unknown) {
    try {
      const dto = listRuleExecutionsQuerySchema.parse(query);
      return await this.rules.listExecutions(
        dto,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post("evaluate")
  @HttpCode(HttpStatus.OK)
  async evaluateEnabledRules(@CurrentUser() user: JwtPayload) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    return this.rules.evaluateEnabledRules(
      user,
      await this.accessControl.readableAssetIds(user),
    );
  }

  @Post("preview")
  @HttpCode(HttpStatus.OK)
  async previewRule(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    // Preview writes: rules.service.ts inserts a `rule_preview` audit row on
    // every call. It is also a rule-authoring aid, so it carries the same
    // class as the rest of rule authoring rather than being exempt.
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    try {
      const dto = rulePreviewBodySchema.parse(body);
      return await this.rules.previewRule(
        dto,
        user,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post()
  async createDraft(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    try {
      const dto = ruleDraftBodySchema.parse(body);
      return await this.rules.createDraft(
        dto,
        user,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Patch(":id")
  async updateRule(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    try {
      const ruleId = idParamSchema.parse(id);
      const dto = ruleUpdateBodySchema.parse(body);
      return await this.rules.updateRule(
        ruleId,
        dto,
        user,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post(":id/publish")
  async publishRule(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    try {
      const ruleId = idParamSchema.parse(id);
      const dto = ruleLifecycleBodySchema.parse(body);
      return await this.rules.publishRule(
        ruleId,
        dto,
        user,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post(":id/duplicate")
  async duplicateRule(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    try {
      const ruleId = idParamSchema.parse(id);
      const dto = ruleLifecycleBodySchema.parse(body);
      return await this.rules.duplicateRule(
        ruleId,
        dto,
        user,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post(":id/archive")
  async archiveRule(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    try {
      const ruleId = idParamSchema.parse(id);
      const dto = ruleLifecycleBodySchema.parse(body);
      return await this.rules.archiveRule(
        ruleId,
        dto,
        user,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Patch(":id/enabled")
  async setEnabled(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    try {
      const ruleId = idParamSchema.parse(id);
      const dto = ruleToggleBodySchema.parse(body);
      return await this.rules.setEnabled(
        ruleId,
        dto,
        user,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
