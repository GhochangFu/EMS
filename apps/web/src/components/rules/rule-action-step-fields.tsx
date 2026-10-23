import { fieldClass, labelClass } from "../admin/admin-wizard-frame";
import { type RuleValues, type SetRuleValues, textOf } from "./rule-wizard-fields";

/** `F4.278` — the rule wizard's Action step (`rule-wizard.tsx`), split out for AGENTS.md §4.2. */
export function ActionStepFields({
  values,
  setValues,
  withReason,
}: {
  values: RuleValues;
  setValues: SetRuleValues;
  withReason: boolean;
}) {
  const action = (values.action ?? { type: "notify", target: "" }) as {
    type?: string;
    target?: string;
  };
  return (
    <>
      <label className={labelClass}>
        Action
        <select
          aria-label="Action"
          className={fieldClass}
          value={action.type ?? "notify"}
          onChange={(e) =>
            setValues({
              ...values,
              action: { ...action, type: e.target.value },
            })
          }
        >
          <option value="notify">Notify</option>
          <option value="review">Review</option>
          <option value="trace_only">Trace only</option>
        </select>
      </label>
      <label className={labelClass}>
        Target
        <input
          aria-label="Target"
          className={fieldClass}
          value={action.target ?? ""}
          onChange={(e) =>
            setValues({
              ...values,
              action: { ...action, target: e.target.value },
            })
          }
          placeholder="Operations"
        />
      </label>
      {withReason && (
        <label className={labelClass}>
          Reason (optional)
          <input
            aria-label="Reason"
            className={fieldClass}
            value={textOf(values, "reason")}
            onChange={(e) =>
              setValues({
                ...values,
                reason: e.target.value === "" ? undefined : e.target.value,
              })
            }
          />
        </label>
      )}
    </>
  );
}
