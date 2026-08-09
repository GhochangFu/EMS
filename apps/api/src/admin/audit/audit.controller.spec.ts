import type { JwtPayload } from "@bms/shared";

import { AuditAdminController } from "./audit.controller";
import type { AuditExportFile } from "./audit.service";
import type { AuditAdminService } from "./audit.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const JWT: JwtPayload = {
  sub: "00000000-0000-4000-8000-000000000000",
  email: "admin@bms.local",
  name: "spec",
  role: "admin",
};

/** Records what the controller passed down, so the parse step is observable. */
type Call = { query: unknown };

function stubService(file?: AuditExportFile): {
  service: AuditAdminService;
  listCalls: Call[];
  exportCalls: Call[];
} {
  const listCalls: Call[] = [];
  const exportCalls: Call[] = [];
  const service = {
    async list(_jwt: JwtPayload, query: unknown) {
      listCalls.push({ query });
      return { items: [], total: 0, limit: 50, offset: 0 };
    },
    async export(_jwt: JwtPayload, query: unknown) {
      exportCalls.push({ query });
      return (
        file ?? {
          filename: "audit-2026-08-01.csv",
          contentType: "text/csv; charset=utf-8",
          body: "id\n",
        }
      );
    },
  } as unknown as AuditAdminService;
  return { service, listCalls, exportCalls };
}

/** Minimal Express double — only what the export handler touches. */
function stubResponse() {
  const headers: Record<string, string> = {};
  let sent: unknown = undefined;
  return {
    headers,
    get sent() {
      return sent;
    },
    res: {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      send(body: unknown) {
        sent = body;
      },
    },
  };
}

async function rejectsWith(
  run: () => Promise<unknown>,
  what: string,
): Promise<{ name: string; status: number | undefined }> {
  try {
    await run();
  } catch (err) {
    const e = err as { name: string; getStatus?: () => number };
    return { name: e.name, status: e.getStatus?.() };
  }
  throw new Error(`${what}: expected a rejection, but the call resolved`);
}

/** ADR 0021 — the controller's parse/response behaviour. */
export async function runAuditControllerTests(): Promise<void> {
  // --- list: valid query reaches the service already parsed -----------------
  {
    const { service, listCalls } = stubService();
    const controller = new AuditAdminController(service);
    await controller.list(JWT, { limit: "25" });
    assert(listCalls.length === 1, "the service is called once");
    const passed = listCalls[0].query as { limit: number; offset: number };
    assert(passed.limit === 25, "the controller passes the *parsed* query, not the raw one");
    assert(passed.offset === 0, "defaults are applied before the service sees them");
  }

  // --- list: a bad query becomes a 400, not a 500 ---------------------------
  {
    const { service, listCalls } = stubService();
    const controller = new AuditAdminController(service);
    const err = await rejectsWith(
      () => controller.list(JWT, { limit: 9999 }),
      "over-max limit",
    );
    assert(err.status === 400, `ZodError maps to 400, got ${err.status}`);
    assert(listCalls.length === 0, "a rejected query never reaches the service");
  }
  {
    const { service } = stubService();
    const controller = new AuditAdminController(service);
    const err = await rejectsWith(
      () => controller.list(JWT, { nope: "x" }),
      "unknown query key",
    );
    assert(err.status === 400, "an unknown key is a 400");
  }

  // --- export: headers, including the ones a review would ask for -----------
  {
    const { service } = stubService();
    const controller = new AuditAdminController(service);
    const out = stubResponse();
    await controller.export(
      JWT,
      { from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" },
      out.res as never,
    );
    assert(
      out.headers["Content-Type"] === "text/csv; charset=utf-8",
      "content type is set from the service's file",
    );
    assert(
      out.headers["Content-Disposition"] === 'attachment; filename="audit-2026-08-01.csv"',
      `disposition names the file, got ${out.headers["Content-Disposition"]}`,
    );
    assert(
      out.headers["Cache-Control"] === "no-store",
      "an audit export must not be cached by a browser or intermediary",
    );
    assert(out.sent === "id\n", "the body is sent verbatim");
  }

  // --- export: a missing window is a 400 and never reaches the service ------
  {
    const { service, exportCalls } = stubService();
    const controller = new AuditAdminController(service);
    const out = stubResponse();
    const err = await rejectsWith(
      () => controller.export(JWT, {}, out.res as never),
      "export without a window",
    );
    assert(err.status === 400, "a missing export window is a 400");
    assert(exportCalls.length === 0, "the service is never reached");
    assert(
      Object.keys(out.headers).length === 0,
      "no headers are written on the failure path",
    );
  }

  // --- export: a service rejection propagates unchanged ---------------------
  // The row-cap 400 originates in the service; the controller must not swallow
  // it or rewrite it into a 500 on its way out.
  {
    const service = {
      async export() {
        const boom = new Error("Export matches 60000 rows, above the 50000 row limit.");
        boom.name = "BadRequestException";
        (boom as unknown as { getStatus: () => number }).getStatus = () => 400;
        throw boom;
      },
    } as unknown as AuditAdminService;
    const controller = new AuditAdminController(service);
    const out = stubResponse();
    const err = await rejectsWith(
      () =>
        controller.export(
          JWT,
          { from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z" },
          out.res as never,
        ),
      "service-side cap rejection",
    );
    assert(err.status === 400, "the service's 400 survives the controller");
    assert(
      Object.keys(out.headers).length === 0,
      "a failed export writes no headers, so the client gets the error not a truncated file",
    );
  }
}
