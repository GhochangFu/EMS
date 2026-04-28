import {
  Global,
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from "@nestjs/common";

import { MetricsController } from "./metrics.controller";
import { MetricsMiddleware } from "./metrics.middleware";
import { MetricsService } from "./metrics.service";

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsMiddleware],
  exports: [MetricsService],
})
export class ObservabilityModule implements NestModule {
  /** Registers lightweight HTTP metrics middleware for all API routes. */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(MetricsMiddleware)
      .exclude({ path: "metrics", method: RequestMethod.GET })
      .forRoutes("*");
  }
}
