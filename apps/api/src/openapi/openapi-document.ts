import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { OpenAPIObject } from "@nestjs/swagger";

import { REQUEST_SCHEMAS } from "./openapi-registry";
import {
  convertZodSchema,
  LOWER_BOUND_NOTICE,
  REFINED_MARKER,
  type UnexplainedRefinement,
} from "./zod-openapi";

/**
 * `F4.20` / ADR 0029 — assembling the document.
 *
 * Two halves, from two sources, joined here and nowhere else (decision 3):
 *
 * - **Routes, parameters, verbs and auth** come from Nest's own reflection via
 *   `SwaggerModule.createDocument`. That reads the routing decorators and is
 *   correct regardless of DTOs, which this codebase does not have.
 * - **Payload shapes** come from the Zod schemas that actually validate the
 *   request, looked up in {@link REQUEST_SCHEMAS} by `operationId`.
 *
 * `@nestjs/swagger` on its own would produce the first half and an empty object
 * for every body, because it derives schemas from TypeScript metadata on DTO
 * classes and 13 controllers here declare `@Body() body: unknown` (ADR 0029
 * fact 5). This is the file that supplies what it cannot see.
 */

/** OpenAPI operation, narrowed to the parts this file writes. */
type Operation = {
  operationId?: string;
  requestBody?: unknown;
  parameters?: unknown[];
  description?: string;
  [REFINED_MARKER]?: boolean;
};

export interface BuiltDocument {
  readonly document: OpenAPIObject;
  /**
   * Refinements that reached the document with no `.describe()`
   * (ADR 0029 Amendment 1, decision 10). Empty is the only acceptable state.
   */
  readonly unexplained: UnexplainedRefinement[];
  /** operationIds the registry names that the application does not have. */
  readonly orphanedRegistryKeys: string[];
}

/** Verbs that carry a request body rather than query parameters. */
const BODY_VERBS = new Set(["post", "put", "patch"]);

/**
 * What the Swagger UI shell is handed instead of the real document.
 *
 * `SwaggerModule` bakes whatever it is given into `/docs/swagger-ui-init.js`,
 * which is served **unauthenticated** and which `raw: false` does not suppress.
 * Handing it the real document published every path in the API beside the
 * guarded route — measured at 128 KB on the running container. The shell needs
 * a document-shaped object to boot; it does not need this one, and it fetches
 * the real one from the guarded URL at load time.
 */
export const EMPTY_DOCUMENT: OpenAPIObject = {
  openapi: "3.0.0",
  info: { title: "TRINETRA Enterprise EMS API", version: "v1" },
  paths: {},
};

/**
 * Builds the document and reports what is wrong with it rather than throwing.
 *
 * **Reporting rather than throwing is deliberate.** This runs during
 * application bootstrap, and an unexplained refinement is a documentation
 * defect, not a reason to refuse to serve telemetry. The build is failed by
 * `tests/adr-0029-openapi-contract.test.ts` instead, which is where ADR 0029
 * decision 10 says it belongs.
 */
export function buildOpenApiDocument(app: INestApplication): BuiltDocument {
  const config = new DocumentBuilder()
    .setTitle("TRINETRA Enterprise EMS API")
    .setDescription(LOWER_BOUND_NOTICE)
    .setVersion("v1")
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "jwt")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const unexplained: UnexplainedRefinement[] = [];
  const seen = new Set<string>();

  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const [verb, operation] of Object.entries(item as Record<string, Operation>)) {
      const id = operation?.operationId;
      if (!id) {
        continue;
      }
      const schema = REQUEST_SCHEMAS[id];
      if (!schema) {
        continue;
      }
      seen.add(id);

      const converted = convertZodSchema(schema, id);
      unexplained.push(...converted.unexplained);

      if (BODY_VERBS.has(verb.toLowerCase())) {
        operation.requestBody = {
          required: true,
          content: { "application/json": { schema: converted.schema } },
        };
        continue;
      }

      // A GET's schema describes the query string, so its properties become
      // individual `in: "query"` parameters rather than one object. Anything
      // that is not an object (a bare enum on one parameter, for instance)
      // cannot be split and is skipped rather than guessed at — better an
      // undocumented parameter than a wrong one.
      const asObject = converted.schema as {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
      if (asObject.type !== "object" || !asObject.properties) {
        continue;
      }
      const required = new Set(asObject.required ?? []);
      const parameters = Object.entries(asObject.properties).map(([name, propSchema]) => ({
        name,
        in: "query",
        required: required.has(name),
        schema: propSchema,
      }));
      operation.parameters = [...(operation.parameters ?? []), ...parameters];

      // **Splitting the object throws away everything said ABOUT the object**,
      // and that is exactly where a query schema's refinements live: they are
      // cross-field by nature (`from` must not be later than `to`; the window
      // must not exceed 90 days) and so cannot sit on any single parameter.
      //
      // Found by reading the served document rather than by any test: the audit
      // list and export routes came out with their parameters documented and
      // their window rules stated **nowhere** — the same silent-permissiveness
      // defect ADR 0029 Amendment 1 exists to prevent, reintroduced by the code
      // written to prevent it.
      //
      // OpenAPI has no construct for a constraint spanning parameters, so the
      // honest home is the operation's own description, with the marker beside
      // it so a machine can still see that something is unexpressed.
      const objectLevel = converted.schema as {
        description?: string;
        [REFINED_MARKER]?: boolean;
      };
      if (objectLevel[REFINED_MARKER]) {
        operation[REFINED_MARKER] = true;
        if (objectLevel.description) {
          operation.description = [operation.description, objectLevel.description]
            .filter(Boolean)
            .join(" ");
        }
      }
      void path;
    }
  }

  const orphanedRegistryKeys = Object.keys(REQUEST_SCHEMAS).filter((id) => !seen.has(id));

  return { document, unexplained, orphanedRegistryKeys };
}
