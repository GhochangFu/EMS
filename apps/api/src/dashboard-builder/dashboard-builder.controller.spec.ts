import "reflect-metadata";

import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";

import type { DashboardDto, JwtPayload } from "@bms/shared";

import { DashboardBuilderController } from "./dashboard-builder.controller";

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

const ADMIN: JwtPayload = { sub: "u1", email: "admin@bms.local", name: "Admin", role: "admin" };
const VIEWER: JwtPayload = { sub: "u2", email: "viewer@bms.local", name: "Viewer", role: "viewer" };

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const DASHBOARD_ID = "22222222-2222-4222-8222-222222222222";

const dto = {
  id: DASHBOARD_ID,
  organizationId: ORG_ID,
  slug: "overview",
  name: "Overview",
  description: null,
  locationId: null,
  assetGroupId: null,
  assetId: null,
  assetTemplateId: null,
  // `F3.73` (plan D1) — a hand-built dashboard with no tabs.
  templateId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  tabs: [],
  widgets: [],
} as DashboardDto;

type ServiceStub = {
  list: ReturnType<typeof callCounter>;
  getBySlug: ReturnType<typeof callCounter>;
  create: ReturnType<typeof callCounter>;
  update: ReturnType<typeof callCounter>;
  remove: ReturnType<typeof callCounter>;
  putWidgets: ReturnType<typeof callCounter>;
};

/** A stub method that records how many times it ran and always resolves — used to prove a
 * rejected gate never reaches it. */
function callCounter(resolveWith: unknown = dto) {
  const fn = Object.assign(
    (..._args: unknown[]) => {
      fn.calls += 1;
      return Promise.resolve(resolveWith);
    },
    { calls: 0 },
  );
  return fn;
}

function controllerWith(options: {
  service?: Partial<ServiceStub>;
  writeRoleRejects?: boolean;
  /** `F3.73` — the site-widgets service stub; `{}` for every case that never reaches it. */
  siteWidgets?: { forUser: (...args: unknown[]) => Promise<unknown> };
}): {
  controller: DashboardBuilderController;
  service: ServiceStub;
  metricCatalog: { catalogValues: ReturnType<typeof callCounter> };
} {
  const service: ServiceStub = {
    list: callCounter({ items: [] }),
    getBySlug: callCounter(dto),
    create: callCounter(dto),
    update: callCounter(dto),
    remove: callCounter(undefined),
    putWidgets: callCounter(dto),
    ...options.service,
  };

  const accessControl = {
    assertOperationsWriteRole: () =>
      options.writeRoleRejects
        ? Promise.reject(
            new ForbiddenException("Changing rules and maintenance schedules requires an administrator role"),
          )
        : Promise.resolve(undefined),
  } as unknown as ConstructorParameters<typeof DashboardBuilderController>[2];

  // `F3.35` Stage C. A counting stub rather than `{}`: the catalog route is a READ with no
  // `assertOperationsWriteRole` gate, so the write-role cases below must NOT reach it, and a
  // stub that records its calls is what lets a later case assert that.
  const metricCatalog = {
    catalogValues: callCounter({ values: [], resolvedAt: new Date(0).toISOString() }),
  };

  const controller = new DashboardBuilderController(
    service as unknown as ConstructorParameters<typeof DashboardBuilderController>[0],
    metricCatalog as unknown as ConstructorParameters<typeof DashboardBuilderController>[1],
    accessControl,
    // `F3.32` — no case here reaches the mimic-nodes route; its own suite covers it.
    {} as unknown as ConstructorParameters<typeof DashboardBuilderController>[3],
    (options.siteWidgets ?? {}) as unknown as ConstructorParameters<typeof DashboardBuilderController>[4],
  );
  return { controller, service, metricCatalog };
}

const validCreateBody = { organizationId: ORG_ID, slug: "overview", name: "Overview" };
const validWidgetsBody = { widgets: [] };

/**
 * `F3.1b` Task 6 — the dashboard-builder controller, gated by a stubbed `DashboardsService`.
 * Assertions live here; `dashboard-builder.controller.test.ts` is the Vitest entry point
 * (ADR 0014).
 */
export async function runDashboardBuilderControllerTests(): Promise<void> {
  // -------------------------------------------------------------------------
  // Order matters: assertOperationsWriteRole runs BEFORE the service, and a
  // rejection prevents the service call entirely — proven by the stub's own
  // call counter staying at zero. viewer -> 403 on all four mutating routes.
  // -------------------------------------------------------------------------
  {
    const { controller, service } = controllerWith({ writeRoleRejects: true });

    await rejects(
      () => controller.create(VIEWER, validCreateBody),
      (e) => e instanceof ForbiddenException,
      "viewer creating a dashboard",
    );
    assert(service.create.calls === 0, "create() must never reach the service after a gate rejection");

    await rejects(
      () => controller.update(VIEWER, DASHBOARD_ID, { name: "x" }),
      (e) => e instanceof ForbiddenException,
      "viewer updating a dashboard",
    );
    assert(service.update.calls === 0, "update() must never reach the service after a gate rejection");

    await rejects(
      () => controller.remove(VIEWER, DASHBOARD_ID),
      (e) => e instanceof ForbiddenException,
      "viewer removing a dashboard",
    );
    assert(service.remove.calls === 0, "remove() must never reach the service after a gate rejection");

    await rejects(
      () => controller.putWidgets(VIEWER, DASHBOARD_ID, validWidgetsBody),
      (e) => e instanceof ForbiddenException,
      "viewer replacing widgets",
    );
    assert(
      service.putWidgets.calls === 0,
      "putWidgets() must never reach the service after a gate rejection",
    );
  }

  // viewer -> 200 on both reads (no write-role gate applies to GET).
  {
    const { controller } = controllerWith({ writeRoleRejects: true });
    const listed = await controller.list(VIEWER, {});
    assert(Array.isArray(listed.items), "list() must succeed for a viewer");
    const got = await controller.getBySlug(VIEWER, "overview", {});
    assert(got.slug === "overview", "getBySlug() must succeed for a viewer");
  }

  // -------------------------------------------------------------------------
  // Each handler .parse()s its body with the schema it is registered under —
  // an invalid body is a 400 before the service is ever reached.
  // -------------------------------------------------------------------------
  {
    const { controller, service } = controllerWith({});
    await rejects(
      () => controller.create(ADMIN, { organizationId: ORG_ID, slug: "Not Valid", name: "x" }),
      (e) => e instanceof BadRequestException,
      "a create body with an invalid slug",
    );
    assert(service.create.calls === 0, "an invalid body must never reach the service");

    await rejects(
      () => controller.update(ADMIN, "not-a-uuid", { name: "x" }),
      (e) => e instanceof BadRequestException,
      "a non-uuid dashboard id",
    );

    await rejects(
      () => controller.putWidgets(ADMIN, DASHBOARD_ID, { widgets: [{ widgetType: "radial_gauge" }] }),
      (e) => e instanceof BadRequestException,
      "a widgets body missing required fields",
    );
  }

  // A well-formed body reaches the (stubbed) service with the parsed values.
  {
    const { controller, service } = controllerWith({});
    await controller.create(ADMIN, validCreateBody);
    assert(service.create.calls === 1, "a valid create body must reach the service exactly once");
  }

  // -------------------------------------------------------------------------
  // D5 / ambiguous slug and the cross-tenant 404 — the controller passes
  // organizationId through unchanged and does not translate the service's
  // errors, so these are proven at the service layer (Task 4) and only the
  // pass-through is proven here.
  // -------------------------------------------------------------------------
  {
    const { controller } = controllerWith({
      service: {
        getBySlug: ((_user: JwtPayload, _slug: string, organizationId?: string) =>
          organizationId === undefined
            ? Promise.reject(
                new BadRequestException(
                  "More than one dashboard matches this slug; pass organizationId to disambiguate",
                ),
              )
            : Promise.resolve(dto)) as unknown as ServiceStub["getBySlug"],
      },
    });
    await rejects(
      () => controller.getBySlug(ADMIN, "overview", {}),
      (e) => e instanceof BadRequestException,
      "an ambiguous slug with no organizationId",
    );
    const disambiguated = await controller.getBySlug(ADMIN, "overview", { organizationId: ORG_ID });
    assert(disambiguated.id === DASHBOARD_ID, "the same slug WITH organizationId must resolve the one row");
  }

  {
    const { controller } = controllerWith({
      service: {
        update: (() =>
          Promise.reject(new NotFoundException("Dashboard not found"))) as unknown as ServiceStub["update"],
      },
    });
    await rejects(
      () => controller.update(ADMIN, DASHBOARD_ID, { name: "x" }),
      (e) => e instanceof NotFoundException && (e as NotFoundException).message === "Dashboard not found",
      "the controller must not rewrap the service's cross-tenant 404",
    );
  }
}

/**
 * `F3.32c` U7 — `PUT :id/widgets` naming a layout by an uppercase id is a 400 before the service:
 * the id would be stored as sent, and the resolver keys layouts by the lowercase database id. The
 * lowercase form of the same id reaching the service is the positive control.
 */
export async function putWidgetsRefusesAnUppercaseLayoutIdWith400(): Promise<void> {
  const layoutId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const bodyFor = (id: string) => ({
    widgets: [
      {
        widgetType: "mimic",
        title: "Plant",
        gridX: 0,
        gridY: 0,
        gridW: 12,
        gridH: 6,
        config: { source: "layout", layoutId: id },
        points: [],
      },
    ],
  });
  const { controller, service } = controllerWith({});

  await controller.putWidgets(ADMIN, DASHBOARD_ID, bodyFor(layoutId));
  assert(service.putWidgets.calls === 1, "a lowercase layoutId must reach the service");

  await rejects(
    () => controller.putWidgets(ADMIN, DASHBOARD_ID, bodyFor(layoutId.toUpperCase())),
    (e) => e instanceof BadRequestException,
    "an uppercase layoutId",
  );
  assert(service.putWidgets.calls === 1, "an uppercase layoutId must never reach the service");
}

/**
 * `E4.2` U9 — the controller passes `section` through to the service.
 *
 * **Its own function with its own `it()`, because an optional parameter at an
 * adapter is invisible.** `list()`'s signature gained a fourth optional
 * argument, so the controller keeps compiling whether or not it forwards one —
 * the feature ships inert and every existing test stays green. Only the
 * recorded argument list can say it is wired.
 */
export async function listForwardsTheSectionQueryToTheService(): Promise<void> {
  const seen: unknown[][] = [];
  const list = (...args: unknown[]) => {
    seen.push(args);
    return Promise.resolve({ items: [] });
  };
  const { controller } = controllerWith({
    service: { list: list as unknown as ServiceStub["list"] },
  });

  await controller.list(ADMIN, { section: "sustainability" });
  assert(
    seen[0]?.[3] === "sustainability",
    `list() must receive the section as its fourth argument; got ${JSON.stringify(seen[0])}`,
  );

  // The adjacent control: an omitted `section` must arrive as `undefined`, not
  // as the previous call's value or an empty string — `queryString` on the web
  // side already drops an empty one, so an empty string here would be a filter
  // the client can never clear.
  await controller.list(ADMIN, {});
  assert(
    seen[1]?.[3] === undefined,
    `an omitted section must reach the service as undefined; got ${JSON.stringify(seen[1])}`,
  );
}

/**
 * `F3.72` U0 — the controller passes `locationId` through as the FIFTH `list()`
 * argument. An optional trailing parameter at an adapter is invisible to tsc,
 * so only the recorded argument list can say it is wired. The malformed case
 * is the 400 before the service is called.
 */
export async function listForwardsTheLocationIdQueryToTheService(): Promise<void> {
  const seen: unknown[][] = [];
  const list = (...args: unknown[]) => {
    seen.push(args);
    return Promise.resolve({ items: [] });
  };
  const { controller } = controllerWith({
    service: { list: list as unknown as ServiceStub["list"] },
  });

  const locationId = "33333333-3333-4333-8333-333333333333";
  await controller.list(ADMIN, { locationId });
  assert(
    seen[0]?.[4] === locationId,
    `list() must receive the locationId as its fifth argument; got ${JSON.stringify(seen[0])}`,
  );

  await controller.list(ADMIN, {});
  assert(
    seen[1]?.[4] === undefined,
    `an omitted locationId must reach the service as undefined; got ${JSON.stringify(seen[1])}`,
  );
}

export async function listRefusesAMalformedLocationIdWith400(): Promise<void> {
  const seen: unknown[][] = [];
  const list = (...args: unknown[]) => {
    seen.push(args);
    return Promise.resolve({ items: [] });
  };
  const { controller } = controllerWith({
    service: { list: list as unknown as ServiceStub["list"] },
  });

  await rejects(
    () => controller.list(ADMIN, { locationId: "not-a-uuid" }),
    (e) => e instanceof BadRequestException,
    "a non-uuid locationId must be a 400, not a 500",
  );
  assert(seen.length === 0, "a malformed locationId must not reach the service");
}

/**
 * `F3.73` (plan D9, Task 3.4) — `GET :id/site-widgets` exists, and Nest registers it before
 * `:slug`. Nest scans a controller's prototype in declaration order and reads each handler's
 * `path` metadata, so this asks the two things Nest itself asks: which method carries the path,
 * and whether it comes before the `:slug` handler.
 */
export function siteWidgetsRouteIsDeclaredBeforeSlug(): void {
  const proto = DashboardBuilderController.prototype as unknown as Record<string, unknown>;
  const paths = Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor" && typeof proto[name] === "function")
    .map((name) => Reflect.getMetadata("path", proto[name] as object) as string | undefined);
  const siteAt = paths.indexOf(":id/site-widgets");
  const slugAt = paths.indexOf(":slug");
  assert(siteAt > -1, `no handler carries the ':id/site-widgets' path; got ${JSON.stringify(paths)}`);
  assert(slugAt > -1, "control: the ':slug' handler must still exist");
  assert(siteAt < slugAt, `':id/site-widgets' (at ${siteAt}) must be declared before ':slug' (at ${slugAt})`);
}

const SITE_WIDGETS_ANSWER = { dashboardId: DASHBOARD_ID };

function siteWidgetsRecorder(): { seen: unknown[][]; stub: { forUser: (...args: unknown[]) => Promise<unknown> } } {
  const seen: unknown[][] = [];
  return {
    seen,
    stub: {
      forUser: (...args: unknown[]) => {
        seen.push(args);
        return Promise.resolve(SITE_WIDGETS_ANSWER);
      },
    },
  };
}

/**
 * The `tab` query reaches the service as its third argument, and an absent one as `undefined`.
 * An optional trailing parameter at an adapter is invisible to tsc, so only the recorded
 * argument list can say it is wired.
 */
export async function siteWidgetsForwardsTheTabToTheService(): Promise<void> {
  const { seen, stub } = siteWidgetsRecorder();
  const { controller } = controllerWith({ siteWidgets: stub });

  const answer = await controller.siteWidgetsFor(VIEWER, DASHBOARD_ID, { tab: "sld" });
  assert(answer === SITE_WIDGETS_ANSWER, "the controller must return the service's answer");
  assert(
    seen[0]?.[1] === DASHBOARD_ID && seen[0]?.[2] === "sld",
    `forUser() must receive the id and the tab key; got ${JSON.stringify(seen[0])}`,
  );

  await controller.siteWidgetsFor(VIEWER, DASHBOARD_ID, {});
  assert(
    seen.length === 2 && seen[1]?.[2] === undefined,
    `an omitted tab must reach the service as undefined; got ${JSON.stringify(seen[1])}`,
  );
}

/** A malformed `tab`, an unknown query key or a non-uuid id is a 400 before the service. */
export async function siteWidgetsRefusesAMalformedQueryWith400(): Promise<void> {
  const { seen, stub } = siteWidgetsRecorder();
  const { controller } = controllerWith({ siteWidgets: stub });

  for (const [id, query, why] of [
    [DASHBOARD_ID, { tab: "Not A Key" }, "a tab key outside the tab-key rule"],
    [DASHBOARD_ID, { tab: "sld", extra: "1" }, "an unknown query key"],
    ["not-a-uuid", { tab: "sld" }, "a non-uuid dashboard id"],
  ] as const) {
    await rejects(
      () => controller.siteWidgetsFor(VIEWER, id, query),
      (e) => e instanceof BadRequestException,
      why,
    );
  }
  assert(seen.length === 0, `a malformed request must not reach the service; it ran ${seen.length} time(s)`);
}
