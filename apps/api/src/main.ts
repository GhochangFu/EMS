import "./load-env";
import "./observability/tracing";

import { Logger, RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { type NestExpressApplication } from "@nestjs/platform-express";
import { Logger as PinoLogger } from "nestjs-pino";

import { SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module";
import { buildOpenApiDocument } from "./openapi/openapi-document";
import { OpenApiDocumentStore } from "./openapi/openapi.controller";
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

  // `F4.20` / ADR 0029. The document is built here because
  // `SwaggerModule.createDocument` needs the instantiated application, which is
  // also why it reaches the guarded controller through a store rather than DI.
  //
  // **`raw: false` is load-bearing.** Without it `SwaggerModule.setup` also
  // publishes its own copy of the document, unguarded, and decision 2's
  // `JwtAuthGuard` on `/docs-json` becomes decorative — the exact shape of
  // "the guard is wired but does nothing" that AGENTS.md §4.4 records twice.
  // The UI is pointed at the guarded route instead, and `persistAuthorization`
  // keeps the reader's bearer token across reloads so it stays usable.
  const { document } = buildOpenApiDocument(app);
  app.get(OpenApiDocumentStore).set(document);
  SwaggerModule.setup("docs", app, document, {
    useGlobalPrefix: true,
    raw: false,
    swaggerOptions: {
      url: "/api/v1/docs-json",
      persistAuthorization: true,
    },
    customSiteTitle: "TRINETRA EMS API",
  });

  const port = Number(process.env.PORT) || 4000;
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}`, "Bootstrap");
}

void bootstrap();
