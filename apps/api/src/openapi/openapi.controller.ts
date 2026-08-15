import { Controller, Get, Injectable, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import type { OpenAPIObject } from "@nestjs/swagger";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";

/**
 * `F4.20` / ADR 0029 decision 2 — the document, behind the JWT.
 *
 * **Why the document is a guarded controller route while the Swagger UI shell
 * is not.** The owner chose availability over absence: the endpoint exists in
 * every environment rather than being unregistered in production. Guarding the
 * *UI* route as well would defeat that, because `JwtAuthGuard.canActivate`
 * reads `req.headers.authorization` and requires a `Bearer ` prefix — there is
 * no cookie or query path — and a browser navigating to a URL sends no such
 * header. The address bar would receive a 401 and the UI could never load.
 *
 * So the guard goes on the **content**. The shell is a static bundle carrying
 * no route information; it fetches this route, which refuses without a token.
 * `main.ts` serves that shell with `raw: false`, which is what stops
 * `@nestjs/swagger` from also publishing its own **unguarded** copy of this
 * document at a path of its choosing. Without that flag this guard would be
 * decorative, which is the kind of guard this repo has shipped before.
 */

/**
 * Holds the document between bootstrap and the first request.
 *
 * A store rather than a plain provider because of an ordering fact:
 * `SwaggerModule.createDocument` needs the **instantiated application**, and
 * this controller is part of that application. The document therefore cannot
 * exist when the module graph is built, so `main.ts` fills this in after
 * `NestFactory.create` and before `listen`.
 */
@Injectable()
export class OpenApiDocumentStore {
  private document: OpenAPIObject | null = null;

  set(document: OpenAPIObject): void {
    this.document = document;
  }

  /** Null only if bootstrap never populated it — a wiring bug, not a user error. */
  read(): OpenAPIObject | null {
    return this.document;
  }
}

@Controller("docs-json")
@UseGuards(JwtAuthGuard)
export class OpenApiController {
  constructor(private readonly store: OpenApiDocumentStore) {}

  /**
   * The OpenAPI document. Any authenticated role may read it — ADR 0029
   * decision 2 records that as chosen rather than overlooked, and names the
   * `admin`-only restriction as the available tightening.
   */
  @Get()
  get(): OpenAPIObject {
    const document = this.store.read();
    if (!document) {
      // Reachable only if bootstrap skipped the build — say which, rather than
      // returning an empty document that reads as "this API has no routes".
      throw new ServiceUnavailableException(
        "The OpenAPI document was not built during bootstrap.",
      );
    }
    return document;
  }
}
