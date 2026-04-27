import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  /** Liveness probe for local dev and future orchestration. */
  @Get()
  getHealth(): { status: string } {
    return { status: "ok" };
  }
}
