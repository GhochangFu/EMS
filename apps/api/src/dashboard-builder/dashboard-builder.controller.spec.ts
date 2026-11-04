import "reflect-metadata";

import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  NotImplementedException,
  RequestMethod,
} from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

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
  /** `F4.303` U14 — the widget-append service stub; a recorder for every case. */
  append?: AppendRecorder;
}): {
  controller: DashboardBuilderController;
  service: ServiceStub;
  metricCatalog: { catalogValues: ReturnType<typeof callCounter> };
  append: AppendRecorder;
} {
  const append = options.append ?? appendRecorder();
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
    append as unknown as ConstructorParameters<typeof DashboardBuilderController>[5],
  );
  return { controller, service, metricCatalog, append };
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

/**
 * `F4.247` (ADR 0099 Amendment 5 C3) — `If-Match` reaches `putWidgets` as its FOURTH argument,
 * unquoted. An optional trailing parameter at an adapter is invisible to tsc, so only the
 * recorded argument list says it is wired; the `@Headers("if-match")` decorator itself is the
 * source scan in `common/if-match.spec.ts`. Mutation: drop the fourth argument.
 */
export async function putWidgetsForwardsTheIfMatchUnquoted(): Promise<void> {
  const seen: unknown[][] = [];
  const putWidgets = (...args: unknown[]) => {
    seen.push(args);
    return Promise.resolve(dto);
  };
  const { controller } = controllerWith({ service: { putWidgets: putWidgets as unknown as ServiceStub["putWidgets"] } });
  await controller.putWidgets(ADMIN, DASHBOARD_ID, validWidgetsBody, '"2026-10-20T10:00:00.000Z"');
  assert(seen[0]?.[3] === "2026-10-20T10:00:00.000Z", `If-Match must arrive unquoted; got ${JSON.stringify(seen[0])}`);
  await controller.putWidgets(ADMIN, DASHBOARD_ID, validWidgetsBody);
  assert(seen[1]?.[3] === undefined, `no If-Match must arrive as undefined; got ${JSON.stringify(seen[1])}`);
}

/** Mutation: pass the raw header through unparsed — a weak tag reaches the service. */
export async function putWidgetsRefusesAWeakIfMatchWith400(): Promise<void> {
  const { controller, service } = controllerWith({});
  await rejects(
    () => controller.putWidgets(ADMIN, DASHBOARD_ID, validWidgetsBody, 'W/"2026-10-20T10:00:00.000Z"'),
    (err) => err instanceof BadRequestException,
    "a weak If-Match",
  );
  assert(service.putWidgets.calls === 0, "a weak If-Match must never reach the service");
}

/** Critique C1: a quoted non-instant is a 400 at the controller, never a value the database casts. */
export async function putWidgetsRefusesANonInstantIfMatchWith400(): Promise<void> {
  const { controller, service } = controllerWith({});
  await rejects(
    () => controller.putWidgets(ADMIN, DASHBOARD_ID, validWidgetsBody, '"abc"'),
    (err) => err instanceof BadRequestException,
    "a non-instant If-Match",
  );
  assert(service.putWidgets.calls === 0, "a non-instant If-Match must never reach the service");
}

// ---------------------------------------------------------------------------
// `F4.303` U14 (ADR 0108 Amendment 6 item 5) — `POST :id/widgets/append`. The controller's order
// is the id (400), the write role (403), the body (400), then the service; one claim per function.
// ---------------------------------------------------------------------------

type AppendRecorder = { seen: unknown[][]; append: (...args: unknown[]) => Promise<unknown> };

const APPEND_ANSWER = { widget: { id: "w1" }, updatedAt: new Date(0).toISOString() };

function appendRecorder(): AppendRecorder {
  const seen: unknown[][] = [];
  return {
    seen,
    append: (...args: unknown[]) => {
      seen.push(args);
      return Promise.resolve(APPEND_ANSWER);
    },
  };
}

const validAppendBody = {
  tabKey: "ops",
  config: { windowMinutes: 1440, aggregate: "avg" },
  points: [{ assetId: "33333333-3333-4333-8333-333333333333", pointKey: "kw" }],
};

const OPERATOR: JwtPayload = { sub: "u3", email: "operator@bms.local", name: "Operator", role: "operator" };

/** An operator is a 403 and the service never runs. Mutation: move the role gate after the call. */
export async function appendWidgetRefusesAnOperatorWith403BeforeTheService(): Promise<void> {
  const { controller, append } = controllerWith({ writeRoleRejects: true });
  await rejects(
    () => controller.appendWidget(OPERATOR, DASHBOARD_ID, validAppendBody),
    (e) => e instanceof ForbiddenException,
    "an operator appending a widget",
  );
  assert(append.seen.length === 0, `a refused role must never reach the service; it ran ${append.seen.length} time(s)`);
}

/** A body the schema refuses is a 400 carrying `flatten()`, and the service never runs. */
export async function appendWidgetRefusesAMalformedBodyWith400(): Promise<void> {
  const { controller, append } = controllerWith({});
  let caughtErr: unknown = null;
  try {
    await controller.appendWidget(ADMIN, DASHBOARD_ID, { ...validAppendBody, config: { windowMinutes: 1440 } });
  } catch (err) {
    caughtErr = err;
  }
  assert(caughtErr instanceof BadRequestException, `a body without aggregate must be a 400; got ${String(caughtErr)}`);
  const response = (caughtErr as BadRequestException).getResponse() as { fieldErrors?: Record<string, unknown> };
  assert(
    response.fieldErrors !== undefined && "config" in response.fieldErrors,
    `the 400 must be the flatten() shape naming config; got ${JSON.stringify(response)}`,
  );
  assert(append.seen.length === 0, "a malformed body must never reach the service");
}

/** A non-uuid id is a 400 before the service. */
export async function appendWidgetRefusesANonUuidIdWith400(): Promise<void> {
  const { controller, append } = controllerWith({});
  await rejects(
    () => controller.appendWidget(ADMIN, "not-a-uuid", validAppendBody),
    (e) => e instanceof BadRequestException,
    "a non-uuid dashboard id",
  );
  assert(append.seen.length === 0, "a non-uuid id must never reach the service");
}

/** A valid request reaches the service with the user, the id and the parsed body, and returns its answer. */
export async function appendWidgetReturnsTheServiceAnswer(): Promise<void> {
  const { controller, append } = controllerWith({});
  const answer = await controller.appendWidget(ADMIN, DASHBOARD_ID, validAppendBody);
  assert(answer === APPEND_ANSWER, "the controller must return the service's answer unchanged");
  assert(
    append.seen.length === 1 && append.seen[0]?.[0] === ADMIN && append.seen[0]?.[1] === DASHBOARD_ID,
    `the service must receive the user and the id; got ${JSON.stringify(append.seen)}`,
  );
  assert(
    JSON.stringify(append.seen[0]?.[2]) === JSON.stringify(validAppendBody),
    `the service must receive the parsed body; got ${JSON.stringify(append.seen[0]?.[2])}`,
  );
}

/** The route answers 201 (`@HttpCode`) on `POST :id/widgets/append`. */
export function appendWidgetAnswers201OnItsPath(): void {
  const handler = DashboardBuilderController.prototype.appendWidget as unknown as object;
  assert(
    Reflect.getMetadata(HTTP_CODE_METADATA, handler) === HttpStatus.CREATED,
    `appendWidget must answer 201; got ${String(Reflect.getMetadata(HTTP_CODE_METADATA, handler))}`,
  );
  assert(
    Reflect.getMetadata(PATH_METADATA, handler) === ":id/widgets/append",
    `appendWidget's path; got ${String(Reflect.getMetadata(PATH_METADATA, handler))}`,
  );
  assert(Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.POST, "appendWidget must be a POST");
}

/** `appendWidget` is declared after `putWidgets` (the plan's order scan). */
export function appendWidgetIsDeclaredAfterPutWidgets(): void {
  const names = Object.getOwnPropertyNames(DashboardBuilderController.prototype);
  const putAt = names.indexOf("putWidgets");
  const appendAt = names.indexOf("appendWidget");
  assert(putAt > -1 && appendAt > -1, `both handlers must exist; got ${JSON.stringify(names)}`);
  assert(appendAt > putAt, `appendWidget (at ${appendAt}) must be declared after putWidgets (at ${putAt})`);
}

// ---------------------------------------------------------------------------
// `F4.306` U6 (ADR 0108 Amendment 7) — the body is `appendWidgetBodySchema`'s two arms. The
// controller picks the arm by `widgetType`, so a refusal keeps the arm's `flatten()` field
// errors; until U7 builds the service's trend arm, a valid trend body is a 501 that never
// reaches the chart service.
// ---------------------------------------------------------------------------

const validTrendBody = { widgetType: "trend_strip", strips: [{ tabKey: "ops", config: { defaultRange: "24h" } }] };

async function appendCaught(body: unknown): Promise<{ err: unknown; append: AppendRecorder }> {
  const { controller, append } = controllerWith({});
  try {
    await controller.appendWidget(ADMIN, DASHBOARD_ID, body);
  } catch (err) {
    return { err, append };
  }
  return { err: null, append };
}

/** A trend body with nine strips is a 400 whose `flatten()` names `strips`; no service runs. */
export async function appendWidgetRefusesNineStripsWithAFieldError(): Promise<void> {
  const nine = { ...validTrendBody, strips: Array.from({ length: 9 }, () => validTrendBody.strips[0]) };
  const { err, append } = await appendCaught(nine);
  assert(err instanceof BadRequestException, `nine strips must be a 400; got ${String(err)}`);
  const response = (err as BadRequestException).getResponse() as { fieldErrors?: Record<string, unknown> };
  assert(
    response.fieldErrors !== undefined && "strips" in response.fieldErrors,
    `the 400 must be the trend arm's flatten() naming strips; got ${JSON.stringify(response)}`,
  );
  assert(append.seen.length === 0, "a refused trend body must never reach the service");
}

/** `widgetType` beside a chart's `points` parses as neither arm: a 400, and no service runs. */
export async function appendWidgetRefusesWidgetTypeWithPoints(): Promise<void> {
  const { err, append } = await appendCaught({ ...validAppendBody, widgetType: "trend_strip" });
  assert(err instanceof BadRequestException, `widgetType plus points must be a 400; got ${String(err)}`);
  assert(append.seen.length === 0, "a body neither arm admits must never reach the service");
}

/** A valid trend body passes the body parse and is a 501 (U7 owns its service), never the chart service. */
export async function appendWidgetSendsAValidTrendBodyPastTheParse(): Promise<void> {
  const { err, append } = await appendCaught(validTrendBody);
  assert(err instanceof NotImplementedException, `a valid trend body must pass the parse; got ${String(err)}`);
  assert(append.seen.length === 0, "a trend body must never reach the chart arm's service");
}
