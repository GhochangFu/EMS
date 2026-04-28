import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { MetricsService } from "./metrics.service";

function routeLabel(req: Request): string {
  if (req.route && typeof req.route.path === "string") {
    return `${req.baseUrl}${req.route.path}`;
  }
  return req.path;
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  /** Records request duration after the response has finished. */
  use(req: Request, res: Response, next: NextFunction): void {
    const started = process.hrtime.bigint();
    res.once("finish", () => {
      if (req.path === "/metrics") {
        return;
      }
      const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
      this.metrics.observeHttpRequest(
        req.method,
        routeLabel(req),
        res.statusCode,
        elapsed,
      );
    });
    next();
  }
}
