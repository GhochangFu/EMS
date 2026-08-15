import "./load-env";
import "./observability/tracing";

import { Logger, RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { type NestExpressApplication } from "@nestjs/platform-express";
import { Logger as PinoLogger } from "nestjs-pino";

import { SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module";
import { buildOpenApiDocument, EMPTY_DOCUMENT } from "./openapi/openapi-document";
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
  // **The UI is given an EMPTY document on purpose**, and this is the part that
  // makes decision 2's guard real rather than decorative.
  //
  // `raw: false` stops `SwaggerModule` publishing `/docs-json` and
  // `/docs-yaml`. It does **not** stop it generating
  // `/docs/swagger-ui-init.js`, which bakes whatever document it is handed
  // straight into an unauthenticated script. Measured against the running
  // container: with the real document passed here, that file was **200 without
  // a token and 128 KB**, containing every path in the API — so the
  // `JwtAuthGuard` on `/docs-json` was guarding a copy while another sat beside
  // it in the open. No test caught this; hitting the running stack did, which
  // is the fourth consecutive item where that has been true (§4.6).
  //
  // So the shell is handed a document with no paths, and told to fetch the real
  // one from the guarded route at load time. `persistAuthorization` keeps the
  // reader's bearer token across reloads so the page stays usable.
  const { document } = buildOpenApiDocument(app);
  app.get(OpenApiDocumentStore).set(document);
  SwaggerModule.setup("docs", app, EMPTY_DOCUMENT, {
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
