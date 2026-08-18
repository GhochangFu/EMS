import { Controller, Get, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { VocabulariesService } from "./vocabularies.service";

/**
 * `GET /api/v1/vocabularies` — the rule-concern and plant-domain vocabularies
 * (ADR 0031 Amendment 1) and the alarm-severity one (ADR 0032).
 *
 * One endpoint rather than three: every consumer needs them together — the
 * rules page renders a concern badge beside a plant badge and a severity
 * control — so one request means one cache key and no half-loaded render. ADR
 * 0032 strengthened that argument rather than weakening it: the alarms page
 * cannot classify a single row until the severity list has arrived.
 *
 * **Not scoped by asset access, deliberately.** These are product-level
 * reference lists, not tenant data: knowing that `hvac` is a valid domain
 * reveals nothing about which plant a user may see. Authentication is still
 * required, because nothing in this API is anonymous.
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
