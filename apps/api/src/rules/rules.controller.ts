import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  NotFoundException,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { ZodError, z } from "zod";

import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { ChannelsService } from "../notifications/channels.service";
import { setRuleNotificationsBodySchema } from "../notifications/notifications.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { EvaluateThrottle, throttleKeysFor } from "./evaluate-throttle";
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
    // Last on purpose (`F3.47`): `rules-notifications.spec.ts` constructs this
    // controller by hand and reads `ConstructorParameters<…>[0..2]`, so adding
    // the throttle anywhere else would silently change what those mean.
    private readonly throttle: EvaluateThrottle,
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
      // ADR 0046 Amendment 3: the projection is keyed on the **database role**,
      // resolved separately. Do not collapse this into the `assetIds === null`
      // above — that picks out the same callers today only by coincidence, and
      // Amendment 2 forbids relying on it.
      return await this.rules.listExecutions(
        dto,
        await this.accessControl.readableAssetIds(user),
        !(await this.accessControl.isGlobalAdmin(user)),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * *Evaluate now* — one sweep of every enabled, published rule in every
   * organization (ADR 0033 decision 2), bounded to one per 30 s per throttle
   * bucket (`F3.47`, `evaluate-throttle.ts`): the caller's organizations, or
   * one of two stand-ins when they have none. The resulting ceiling is K + 1 +
   * G sweeps per 30 s per API process, and `evaluate-throttle.ts` states it in
   * full — it is not a fleet-wide bound and must not be described as one.
   *
   * **The rate bound lives here, at the route, and nowhere else.** A second
   * caller of `RulesService.evaluateEnabledRules` — a job, a second endpoint —
   * bypasses it entirely, and `AlarmRaiseService` already writes
   * `bms.rule_executions` unthrottled. This endpoint is bounded; the table is
   * not.
   *
   * **The order of these four steps is the design, not habit.**
   *
   * 1. The role check stays first, so a `viewer` gets 403 and never 429. That
   *    is also why the throttle is an injectable this body calls rather than a
   *    guard: a guard runs before the body, would answer 429 to a caller who
   *    may not press the button at all, and would let them observe another
   *    organization's throttle state.
   * 2. `readableOrganizationIds`, **not** `writableOrganizationIds` — the
   *    obvious helper is a trap. It calls `assertMasterDataRole`, which
   *    excludes `asset_group_admin`, a role `WRITE_MATRIX` gives
   *    `configuration: true`. Reaching for it would 403 someone allowed to
   *    press this.
   * 3. The throttle, before anything expensive.
   * 4. Only then the caller's asset scope and the sweep itself. A refused press
   *    costs two `resolveDbUser` calls and **at most one** grant walk — a
   *    global admin walks zero, because `readableOrganizationIds` returns
   *    `null` from its `role === "admin"` branch before the loop over read
   *    scope sources. It costs neither the full scope resolution, the 289
   *    inserts, the 289 updates, nor the cross-org alarm raises and
   *    notification dispatches inside the sweep.
   *
   * `Retry-After` is set but deliberately **not** in `main.ts`'s
   * `exposedHeaders`: the SPA is a different origin and would read `null` from
   * it, so the seconds are in the message body, where `apiErrorMessage` already
   * unwraps them. Do not add one half of that pair without the other.
   */
  @Post("evaluate")
  @HttpCode(HttpStatus.OK)
  async evaluateEnabledRules(
    @CurrentUser() user: JwtPayload,
    // `passthrough: true`: Nest still serialises the success body itself. Only
    // the refusal touches `res`, and only to set one header — `HttpException`
    // cannot carry one.
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");

    // `user.sub`, and **which** field this is matters. The second argument is
    // read only when the caller has no organization, so `throttleKeysFor`'s
    // required parameter stops it being dropped — a compile error — and stops
    // nothing else: any `string` typechecks here. `user.name` would fold every
    // grantless caller sharing a display name into one bucket, where each holds
    // the others' button for the life of the process. Block 19 of
    // `evaluate-throttle-route.spec.ts` is the gate; nothing else observes this
    // value, because every other test runs the non-empty branch.
    const decision = this.throttle.check(
      throttleKeysFor(await this.accessControl.readableOrganizationIds(user), user.sub),
      Date.now(),
    );
    if (!decision.allowed) {
      const { retryAfterSeconds } = decision;
      res.setHeader("Retry-After", String(retryAfterSeconds));
      // Scope-neutral on purpose. The bucket is the caller's organization only
      // when they hold one; a global admin and a grantless caller are keyed
      // otherwise (`evaluate-throttle.ts`), so naming the organization here
      // would be false for them — and §9.6 keeps the id itself out regardless.
      // The seconds are in the body because `Retry-After` is set but not
      // exposed across the origin: this sentence is the operator's only channel
      // for the wait, which is why `evaluate-throttle-route.spec.ts` gates the
      // number in it against the number in the header.
      throw new HttpException(
        `Rules were evaluated moments ago. Try again in ${retryAfterSeconds} ${
          retryAfterSeconds === 1 ? "second" : "seconds"
        }.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

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
