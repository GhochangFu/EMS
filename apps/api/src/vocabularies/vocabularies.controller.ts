import { Controller, Get, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { VocabulariesService } from "./vocabularies.service";

/**
 * `GET /api/v1/vocabularies` — the rule-concern and plant-domain vocabularies
 * (ADR 0031 Amendment 1), the alarm-severity one (ADR 0032), the alarm-skill
 * one (ADR 0034) and the asset-role one (ADR 0049 decision 5, `F3.37`).
 *
 * One endpoint rather than five: every consumer needs them together — the
 * rules page renders a concern badge beside a plant badge and a severity
 * control — so one request means one cache key and no half-loaded render. Each
 * addition strengthened that argument rather than weakening it: the alarms
 * page cannot classify a single row until the severity list has arrived, and
 * the asset-groups page cannot label a membership until the role list has.
 *
 * **Not scoped by asset access, deliberately.** These are product-level
 * reference lists, not tenant data: knowing that `hvac` is a valid domain or
 * that `chiller` is a valid role reveals nothing about which plant a user may
 * see, and `bms.asset_roles` is a global table with no `organization_id` at
 * all. Authentication is still required, because nothing in this API is
 * anonymous.
 */
@Controller("vocabularies")
@UseGuards(JwtAuthGuard)
export class VocabulariesController {
  constructor(private readonly vocabularies: VocabulariesService) {}

  @Get()
  async list() {
    return this.vocabularies.list();
  }
}
