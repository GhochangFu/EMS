import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { HTTP_CODE_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import type { EscalationDefaultsResponse, EscalationProfileDto, JwtPayload } from "@bms/shared";

import {
  EscalationDefaultsController,
  EscalationProfilesController,
} from "./escalation-profiles.controller";
import type { EscalationProfilesService } from "./escalation-profiles.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function rejects(
  run: () => Promise<unknown>,
  is: (err: unknown) => boolean,
  why: string,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    assert(is(err), `${why}: threw ${String(err)}`);
    return;
  }
  throw new Error(`${why}: it did not throw`);
}

const ADMIN = { sub: "u1", email: "admin@bms.local", name: "Admin", role: "admin" } as JwtPayload;
const PROFILE_ID = "cccccccc-0000-4000-8000-00000000000c";
const ORG_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const CHANNEL_A = "11111111-0000-4000-8000-000000000001";

const dto: EscalationProfileDto = {
  id: PROFILE_ID,
  organizationId: ORG_A,
  code: "after-hours",
  name: "After hours",
  steps: [{ stepNo: 1, afterMinutes: 5, channelIds: [CHANNEL_A] }],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const defaults: EscalationDefaultsResponse = {
  organizationId: ORG_A,
  items: [{ severity: "critical", profileId: PROFILE_ID, profileCode: "after-hours" }],
};

/** Only the methods the controllers call; each test overrides what it drives. */
function service(overrides: Partial<EscalationProfilesService> = {}): EscalationProfilesService {
  return {
    list: () => Promise.resolve([dto]),
    create: () => Promise.resolve(dto),
    update: () => Promise.resolve(dto),
    remove: () => Promise.resolve(true),
    getDefaults: () => Promise.resolve(defaults),
    setDefaults: () => Promise.resolve(defaults),
    ...overrides,
  } as unknown as EscalationProfilesService;
}

/**
 * `F3.10` U8 — the controller pair (ADR 0057 decision 7).
 *
 * Two controllers in one file, the `asset-groups.controller.ts` precedent: the
 * severity map is addressed by organization and not by profile id, so
 * `/admin/escalation-profiles/defaults` would carry a decorative segment the
 * server must either ignore or check.
 *
 * A Nest module cannot be instantiated under Vitest here (esbuild emits no
 * `design:paramtypes`, `F4.20`), so the routing claims are read off the
 * decorator metadata `RouterExecutionContext` reads — the
 * `reports.controller.spec.ts` idiom — and the handler behaviour is driven
 * directly.
 */
export async function runEscalationProfilesControllerTests(): Promise<void> {
  // --- the two controllers are mounted where the SPA looks for them --------
  {
    assert(
      Reflect.getMetadata(PATH_METADATA, EscalationProfilesController) ===
        "admin/escalation-profiles",
      "the profile routes live under admin/escalation-profiles",
    );
    assert(
      Reflect.getMetadata(PATH_METADATA, EscalationDefaultsController) ===
        "admin/escalation-defaults",
      "the severity map has its own controller, addressed by organization",
    );
    assert(
      Reflect.getMetadata(HTTP_CODE_METADATA, EscalationProfilesController.prototype.create) === 201,
      "a create answers 201, not 200",
    );
  }

  // --- a bad body is a 400 carrying Zod's flatten(), not a 500 -------------
  //
  // The repo shape every route in `rules.controller.ts` uses: the response
  // body names the field, so the admin page can put the message beside the
  // input rather than showing "Internal server error".
  {
    const controller = new EscalationProfilesController(service());
    await rejects(
      () => controller.create(ADMIN, { code: "After Hours", name: "x" }),
      (e) => {
        if (!(e instanceof BadRequestException)) return false;
        const response = e.getResponse() as { fieldErrors?: Record<string, string[]> };
        return Array.isArray(response.fieldErrors?.code);
      },
      "a code that is not lowercase-and-hyphens",
    );
    await rejects(
      () => controller.update(ADMIN, PROFILE_ID, {}),
      (e) => e instanceof BadRequestException,
      "an empty PATCH",
    );
    await rejects(
      () => controller.update(ADMIN, "not-a-uuid", { name: "x" }),
      (e) => e instanceof BadRequestException,
      "an id that is not a uuid",
    );

    const defaultsController = new EscalationDefaultsController(service());
    await rejects(
      () => defaultsController.set(ADMIN, { items: [{ severity: "critical" }] }),
      (e) => e instanceof BadRequestException,
      "a severity map item with no profile",
    );
  }

  // --- an unknown profile is a 404, and the service's own refusals pass through
  {
    const missing = new EscalationProfilesController(
      service({ update: () => Promise.resolve(null), remove: () => Promise.resolve(false) }),
    );
    await rejects(
      () => missing.update(ADMIN, PROFILE_ID, { name: "Renamed" }),
      (e) => e instanceof NotFoundException,
      "patching a profile that does not exist",
    );
    await rejects(
      () => missing.remove(ADMIN, PROFILE_ID),
      (e) => e instanceof NotFoundException,
      "deleting a profile that does not exist",
    );

    const mapped = new EscalationProfilesController(
      service({
        remove: () =>
          Promise.reject(
            new ConflictException("A severity still maps to this profile — unmap it first."),
          ),
      }),
    );
    await rejects(
      () => mapped.remove(ADMIN, PROFILE_ID),
      (e) => e instanceof ConflictException,
      "deleting a profile a severity still maps to",
    );
  }

  // --- the happy shapes match the contracts the SPA parses ------------------
  {
    const controller = new EscalationProfilesController(service());
    const list = await controller.list(ADMIN);
    assert(list.items.length === 1, "the list route answers the { items } envelope");

    const created = await controller.create(ADMIN, {
      organizationId: ORG_A,
      code: "after-hours",
      name: "After hours",
      steps: [{ afterMinutes: 5, channelIds: [CHANNEL_A] }],
    });
    assert(created.id === PROFILE_ID, "the created profile is returned, not a bare id");

    const removed = await controller.remove(ADMIN, PROFILE_ID);
    assert(removed.deleted === true, "a delete answers { deleted: true }");

    const defaultsController = new EscalationDefaultsController(service());
    const read = await defaultsController.get(ADMIN, { organizationId: ORG_A });
    assert(read.organizationId === ORG_A, "the map names the organization it belongs to");
    const written = await defaultsController.set(ADMIN, {
      organizationId: ORG_A,
      items: [{ severity: "critical", profileId: PROFILE_ID }],
    });
    assert(written.items.length === 1, "the whole map comes back from the PUT");
  }
}
