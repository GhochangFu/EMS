import { Controller, Get } from "@nestjs/common";

import { AssetsService } from "./assets.service";

@Controller("assets")
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  /** Lists seeded / configured assets for telemetry binding. */
  @Get()
  list() {
    return this.assets.listAll();
  }
}
