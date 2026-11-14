import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AlarmsModule } from "../alarms/alarms.module";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { FilterOptionsModule } from "../filter-options/filter-options.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { VocabulariesModule } from "../vocabularies/vocabularies.module";
import { EvaluateThrottle } from "./evaluate-throttle";
import { RuleProposalCheckService } from "./rule-proposal-check.service";
import { RulesBatchService } from "./rules-batch.service";
import { RulesController } from "./rules.controller";
import { RulesService } from "./rules.service";
import { SitePointInventoryService } from "./site-point-inventory.service";

@Module({
  // `AlarmsModule → TelemetryModule` only, so this edge is acyclic — checked
  // before adding it, not assumed (F3.6 task 5).
  // `NotificationsModule` imports nothing from rules, so this edge is acyclic —
  // checked before adding it (F3.8 U7), the same way the AlarmsModule edge was.
  // `F4.361` U5 (ADR 0132): `FilterOptionsModule` exports `AssetFilterScopeService`
  // for `GET /rules`' filters. It imports nothing, so this edge is acyclic.
  imports: [VocabulariesModule, AlarmsModule, NotificationsModule, FilterOptionsModule],
  controllers: [RulesController],
  // `EvaluateThrottle` holds the evaluate-now window in a `Map` on the
  // instance, so it must stay a **singleton** (the default scope). Making it
  // request-scoped would hand every request a fresh Map and throttle nothing,
  // and no unit test in this repository could see that.
  // Since `F4.17` (ADR 0125 Q9) the shared window lives in Redis and the Map is
  // the fallback and the local guard `EvaluateThrottle.claim` reads first — so
  // the singleton rule still holds, for the same reason.
  //
  // `F4.278` (ADR 0099 Amendment 8): `MasterDataAuditService` is the funnel every
  // rule audit row goes through (so a confirmed copilot change carries
  // `via: "copilot"`), and `RulesService` is exported for the copilot's
  // `list_rules` read tool, with `RuleProposalCheckService` for the copilot's
  // write-free proposal check.
  //
  // `F4.288` (ADR 0099 Amendment 9 E2): `SitePointInventoryService` is exported for
  // the copilot's `get_site_point_inventory` read tool (a site's rule-point set
  // and 7-day statistics); it injects the fleet pool only.
  //
  // `F4.289` (ADR 0099 Amendment 9 E3): `RulesBatchService` is `POST /rules/batch`'s
  // write (up to 25 rules created and published in one transaction). Only the
  // controller injects it, so it is provided, not exported.
  providers: [
    RulesService,
    JwtAuthGuard,
    EvaluateThrottle,
    MasterDataAuditService,
    RuleProposalCheckService,
    SitePointInventoryService,
    RulesBatchService,
  ],
  exports: [RulesService, RuleProposalCheckService, SitePointInventoryService],
})
export class RulesModule {}
