import type { MasterDataActiveFilter } from "@bms/shared";

type ActiveFilterBarProps = {
  value: MasterDataActiveFilter;
  onChange: (value: MasterDataActiveFilter) => void;
};

const options: Array<{ value: MasterDataActiveFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];

/** Active / inactive filter pills for master-data tables. */
export function ActiveFilterBar({ value, onChange }: ActiveFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={`rounded border px-3 py-1.5 text-xs font-semibold ${
            value === option.value
              ? "border-bms-green bg-emerald-50 text-emerald-900"
              : "border-gray-200 bg-white text-bms-ink"
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
