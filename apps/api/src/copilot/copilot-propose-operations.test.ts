import { describe, it } from "vitest";

import {
  aCloseOnlyRegistryWithholdsTheAck,
  aCloseWordDoesNotAllowAnAck,
  anAckOnlyRegistryWithholdsTheClose,
  anAckWordDoesNotAllowAClose,
  fillStepFillsTheEnrichmentDetails,
  fillStepRefusesAnAckOnACloseWord,
  anEnrichmentWithASkillCodeIsStored,
  fillStepFillsASkillCode,
  theCreateCardNamesTheAssignee,
  aClosedWorkOrderCloseIsRefused,
  aClosedWorkOrderStatusChangeIsRefused,
  aCloseTheUserDidNotAskForIsRefused,
  aConvertIsStoredAsACreate,
  anAcknowledgedAlarmIsRefused,
  anAckOnAFollowUpIsRefused,
  anAckTheUserDidNotAskForIsRefused,
  anAckWithNoAlarmReadFailsClosed,
  anInactiveScheduleConvertIsRefused,
  aReorderStoresItsMovesOutsideTheHash,
  aReorderThatClosesIsRefused,
  aReorderThatReopensIsRefused,
  aReorderWithADuplicateIsRefused,
  aScheduleWithAWorkOrderIsRefused,
  aStoredAckIsOperationalWithItsReason,
  aStoredCloseIsOperational,
  fillStepRefusesAnUnaskedAck,
  theAckSummaryNamesTheAlarm,
  theRegistryWithholdsAckAndClose,
  theRegistryWithTheSwitchNamesAckAndClose,
  theStatusSummaryNamesFromAndTo,
  theStatusToolRefusesClosed,
} from "./copilot-propose-operations.spec";

/** `F4.284` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.284 — the operations propose tools (ADR 0106 decisions 2-4, DC2, DC3, DC6)", () => {
  it("Decision 3 / 4.7: an acknowledge on an automatic follow-up turn is refused, and nothing is stored.", () => anAckOnAFollowUpIsRefused());
  it("Decision 3: a user turn whose own message did not ask is refused (never from a tool result).", () => anAckTheUserDidNotAskForIsRefused());
  it("A close the user did not ask for is refused too.", () => aCloseTheUserDidNotAskForIsRefused());
  it("The registry without the operational switch names neither tool, and still names the create.", () => theRegistryWithholdsAckAndClose());
  it("With the switch, the registry names both.", () => theRegistryWithTheSwitchNamesAckAndClose());
  it("Decision 4: a stored acknowledge is operational, its body is the reason (so the hash binds it).", () => aStoredAckIsOperationalWithItsReason());
  it("Decision 3: the card names the alarm text, severity, asset and raised time.", () => theAckSummaryNamesTheAlarm());
  it("DC6: an already-acknowledged alarm is refused with the route's sentence.", () => anAcknowledgedAlarmIsRefused());
  it("A target that carries no alarm fails closed.", () => anAckWithNoAlarmReadFailsClosed());
  it("DC6: a closed work order's status change is refused with the route's sentence.", () => aClosedWorkOrderStatusChangeIsRefused());
  it("DC6: a closed work order's close is refused with the route's sentence.", () => aClosedWorkOrderCloseIsRefused());
  it("A stored close is operational, with the reason in the body.", () => aStoredCloseIsOperational());
  it("Decision 2: the status tool refuses closed — a close carries a reason through its own route.", () => theStatusToolRefusesClosed());
  it("The status card says where the work order moves from and to.", () => theStatusSummaryNamesFromAndTo());
  it("DC6: a reorder that reopens a closed work order is refused with the route's sentence.", () => aReorderThatReopensIsRefused());
  it("DC6: a reorder that closes by drag is refused with the route's sentence.", () => aReorderThatClosesIsRefused());
  it("A reorder naming one work order twice is refused with the route's sentence.", () => aReorderWithADuplicateIsRefused());
  it("DC2: a good reorder stores the moves beside the body, and the hash leaves them out.", () => aReorderStoresItsMovesOutsideTheHash());
  it("DC6: an inactive schedule's convert is refused with the route's sentence.", () => anInactiveScheduleConvertIsRefused());
  it("DC6: a schedule with an active work order is refused with the route's sentence.", () => aScheduleWithAWorkOrderIsRefused());
  it("A convertible schedule's convert is stored as a create.", () => aConvertIsStoredAsACreate());
  it("A tool result cannot pre-fill an acknowledge wizard: fill_step refuses it without the user's own words.", () => fillStepRefusesAnUnaskedAck());
  it("A close word alone never allows an acknowledge.", () => aCloseWordDoesNotAllowAnAck());
  it("An ack word alone never allows a work-order close.", () => anAckWordDoesNotAllowAClose());
  it("The registry for a close word withholds the acknowledge.", () => aCloseOnlyRegistryWithholdsTheAck());
  it("The registry for an ack word withholds the close.", () => anAckOnlyRegistryWithholdsTheClose());
  it("fill_step: a close word cannot pre-fill an acknowledge wizard.", () => fillStepRefusesAnAckOnACloseWord());
  it("Ruling 2026-10-25: fill_step fills a skillCode for the enrichment wizard.", () => fillStepFillsASkillCode());
  it("Ruling 2026-10-25: an enrichment with a skill code is stored.", () => anEnrichmentWithASkillCodeIsStored());
  it("the enrichment details step's other fields fill too.", () => fillStepFillsTheEnrichmentDetails());
  it("DC1: a create's card names the assignee the resolver read.", () => theCreateCardNamesTheAssignee());
});
