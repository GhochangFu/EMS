import "./load-env";
import "./observability/tracing";

import { Logger, RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { type NestExpressApplication } from "@nestjs/platform-express";
import { Logger as PinoLogger } from "nestjs-pino";

import { SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module";
import { areApiDocsEnabled } from "./openapi/api-docs-enabled";
import { buildOpenApiDocument } from "./openapi/openapi-document";
import { createSocketIoAdapter } from "./realtime/redis-io.adapter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));
  app.useWebSocketAdapter(await createSocketIoAdapter(app));
  app.setGlobalPrefix("api/v1", {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "metrics", method: RequestMethod.GET },
    ],
  });
  app.enableCors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
  });

  // `F4.20` / ADR 0029 **Amendment 2** — the docs are absent or open, never
  // guarded, and the whole route is registered only where they are wanted.
  //
  // The accepted decision put the document behind `JwtAuthGuard`. That was
  // implemented, deployed and then measured not to work: **Swagger UI does not
  // send an `Authorization` header when it fetches the spec**, so the shell got
  // a 401 it cannot recover from and rendered "No operations defined in spec!".
  // A guarded document is unreadable from a browser by construction. The owner
  // chose absence in production over a page that cannot work.
  //
  // So where enabled, both the UI and the document are **unauthenticated** —
  // deliberately, and `areApiDocsEnabled` is what keeps that out of production.
  // Where disabled, `SwaggerModule.setup` is never called and no route exists
  // to probe.
  if (areApiDocsEnabled(process.env)) {
    const { document } = buildOpenApiDocument(app);
    SwaggerModule.setup("docs", app, document, {
      useGlobalPrefix: true,
      customSiteTitle: "TRINETRA EMS API",
    });
    Logger.log(
      "OpenAPI docs at /api/v1/docs (UNAUTHENTICATED — set API_DOCS_ENABLED=false to disable)",
      "Bootstrap",
    );
  }

  const port = Number(process.env.PORT) || 4000;
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}`, "Bootstrap");
}

void bootstrap();
