import { Controller, Get } from "@nestjs/common";

import { PortalSettingsService } from "./portal-settings.service";

/**
 * `F4.341` (ADR 0118 decision 12, Q5) — `GET /api/v1/public/appearance`, the portal default for
 * the sign-in page. **Unauthenticated by design: no guard.** It answers exactly
 * `{ designSystem, colourProfile }` — two values of closed enums, nothing about an organization,
 * a user or the deployment — so it has nothing to leak. Guards in this API are per controller
 * (`health.controller.ts` is the other unguarded one); this controller holds this one route only.
 */
@Controller("public")
export class PublicAppearanceController {
  constructor(private readonly service: PortalSettingsService) {}

  @Get("appearance")
  async getAppearance() {
    return this.service.readPublic();
  }
}
