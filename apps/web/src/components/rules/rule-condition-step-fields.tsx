import type { RuleBuilderCatalogAsset } from "@bms/shared";

import { fieldClass, labelClass, numberOf } from "../admin/admin-wizard-frame";
import {
  clearHoldInvalidReason,
  DAY_OPTIONS,
  type RuleValues,
  type SetRuleValues,
  textOf,
  valuesForRuleType,
} from "./rule-wizard-fields";

/** `F4.278` — the rule wizard's Condition step (`rule-wizard.tsx`), split out for AGENTS.md §4.2. */
export function ConditionStepFields({
  values,
  setValues,
  assets,
  thresholdText,
  setThresholdText,
  holdText,
  setHoldText,
}: {
  values: RuleValues;
  setValues: SetRuleValues;
  assets: readonly RuleBuilderCatalogAsset[];
  thresholdText: string;
  setThresholdText: (text: string) => void;
  holdText: string;
  setHoldText: (text: string) => void;
}) {
  const ruleType = textOf(values, "ruleType") === "time_window" ? "time_window" : "threshold";
  const assetId = textOf(values, "assetId");
  const pointKeys = assets.find((asset) => asset.id === assetId)?.pointKeys ?? [];
  const condition = (values.condition ?? {}) as {
    days?: string[];
    startTime?: string;
    endTime?: string;
  };
  const holdReason = clearHoldInvalidReason(holdText);
  return (
    <>
      <label className={labelClass}>
        Rule type
        <select
          aria-label="Rule type"
          className={fieldClass}
          value={ruleType}
          onChange={(e) => setValues(valuesForRuleType(values, e.target.value))}
        >
          <option value="threshold">Threshold</option>
          <option value="time_window">Time window</option>
        </select>
      </label>
      {ruleType === "threshold" ? (
        <>
          <label className={labelClass}>
            Asset
            <select
              aria-label="Asset"
              className={fieldClass}
              value={assetId}
              onChange={(e) => setValues({ ...values, assetId: e.target.value, pointKey: "" })}
            >
              <option value="">Select asset</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.code} · {asset.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Telemetry point
            <select
              aria-label="Telemetry point"
              className={fieldClass}
              value={textOf(values, "pointKey")}
              onChange={(e) => setValues({ ...values, pointKey: e.target.value })}
            >
              <option value="">Select point</option>
              {pointKeys.map((pointKey) => (
                <option key={pointKey} value={pointKey}>
                  {pointKey}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Operator
            <select
              aria-label="Operator"
              className={fieldClass}
              value={textOf(values, "operator") || "gt"}
              onChange={(e) => setValues({ ...values, operator: e.target.value })}
            >
              <option value="gt">above</option>
              <option value="gte">at least</option>
              <option value="lt">below</option>
              <option value="lte">at most</option>
              <option value="eq">equals</option>
            </select>
          </label>
          <label className={labelClass}>
            Threshold
            <input
              aria-label="Threshold"
              className={fieldClass}
              inputMode="decimal"
              value={thresholdText}
              onChange={(e) => {
                setThresholdText(e.target.value);
                setValues({
                  ...values,
                  thresholdValue: numberOf(e.target.value),
                });
              }}
              placeholder="3"
            />
          </label>
          <div>
            <label className={labelClass}>
              Clear hold (seconds)
              <input
                aria-label="Clear hold (seconds)"
                className={fieldClass}
                inputMode="numeric"
                value={holdText}
                onChange={(e) => {
                  setHoldText(e.target.value);
                  const raw = e.target.value.trim();
                  setValues({
                    ...values,
                    clearHoldSeconds: raw === "" ? null : Number(raw),
                  });
                }}
                placeholder="120 (default)"
              />
            </label>
            {/* A sibling of the label, not a child: inside it the text would join the field's name. */}
            {holdReason ? <p className="mt-1 text-xs text-warning-ink">{holdReason}</p> : null}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {DAY_OPTIONS.map(([value, label]) => (
              <label key={value} className="flex items-center gap-1 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  checked={(condition.days ?? []).includes(value)}
                  onChange={(e) => {
                    const days = e.target.checked
                      ? [...(condition.days ?? []), value]
                      : (condition.days ?? []).filter((day) => day !== value);
                    setValues({ ...values, condition: { ...condition, days } });
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          <label className={labelClass}>
            Start time
            <input
              aria-label="Start time"
              className={fieldClass}
              type="time"
              value={condition.startTime ?? ""}
              onChange={(e) =>
                setValues({
                  ...values,
                  condition: { ...condition, startTime: e.target.value },
                })
              }
            />
          </label>
          <label className={labelClass}>
            End time
            <input
              aria-label="End time"
              className={fieldClass}
              type="time"
              value={condition.endTime ?? ""}
              onChange={(e) =>
                setValues({
                  ...values,
                  condition: { ...condition, endTime: e.target.value },
                })
              }
            />
          </label>
        </>
      )}
    </>
  );
}
