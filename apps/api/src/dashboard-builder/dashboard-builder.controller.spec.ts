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
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
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
