import { alarmSkillDtoSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool } from "./copilot-read-tool";

/**
 * `list_alarm_skills` (`F4.284`, owner ruling 2026-10-25, Q4) — the active alarm
 * skill vocabulary (ADR 0034, `bms.alarm_skills`) the enrichment route accepts as
 * `skillCode` (`VocabulariesService.assertAlarmSkill`: active rows only). The
 * alarm-enrichment wizard reads the same list (`VocabulariesService.list`, which
 * serves active rows only). A fleet vocabulary, so it names no organization; the
 * `list_asset_roles` shape.
 */
export const listAlarmSkillsTool = defineReadTool({
  name: "list_alarm_skills",
  description:
    "List the active alarm skills (code, label) — the trade an alarm needs. An alarm analysis's skillCode must be a listed code.",
  schema: z.object({}).strict(),
  async run({ vocabularies }) {
    // Only the skill axis is read and checked; the other vocabularies never reach the model.
    const skills = parseStoredContract(z.array(alarmSkillDtoSchema), (await vocabularies.list()).alarmSkills, "copilot_tools.list_alarm_skills.page");
    return {
      ok: true,
      result: { items: skills.filter((skill) => skill.active).map((skill) => ({ code: skill.code, label: skill.label })) },
      organizationIds: [],
    };
  },
});
