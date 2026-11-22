import { useState } from "react";
import {
  deviceProfileCodeSchema,
  deviceProfileSchema,
  MODBUS_REGISTERS_MAX,
  MODBUS_TABLES,
  MODBUS_VALUE_TYPES,
  MODBUS_WORD_ORDERS,
  modbusRegisterSchema,
  modbusRegistersSchema,
} from "@bms/shared";
import type { ModbusRegister, ModbusTable, ModbusValueType, ModbusWordOrder } from "@bms/shared";
import type { DeviceProfileDto } from "@bms/shared/contracts";

import { useCreateDeviceProfile, useSaveDeviceProfileVersion } from "../../api/admin/device-profiles";
import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";
import { SectionCard } from "../section-card";

type DeviceProfileEditorProps = {
  /** The organization a new profile is created in; an opened profile keeps its own. */
  organizationId: string;
  /**
   * The row the editor was opened on — the NEWEST version of its code (the page
   * guarantees it) — or `null` for a new profile. Save sends its `version` as
   * `baseVersion`.
   */
  base: DeviceProfileDto | null;
  /** After a save that landed, and on Cancel. */
  onClose: () => void;
  /** From the stale-save message: the page closes the editor and reads the list again. */
  onReload: () => void;
};

/** One register as the form holds it: numbers stay text until they are checked. */
type RowDraft = {
  /** A React key; never sent. */
  key: number;
  touched: boolean;
  sourceKey: string;
  table: ModbusTable;
  address: string;
  type: ModbusValueType;
  wordOrder: ModbusWordOrder;
  byteSwap: boolean;
  scale: string;
  offset: string;
  unit: string;
};

type Fields = { code: string; vendor: string; model: string; document: string; revision: string; pages: string };

/** The code rule in words; the page's Copy form says the same. */
const CODE_RULE = "A code is letters, digits, _ and -, at most 64 characters.";

const STALE_SAVE_SENTENCE =
  "Someone saved a newer version of this profile while you were editing it. Reload to open the newest version, then make your change again.";

let nextKey = 1;

function emptyRow(): RowDraft {
  return {
    key: nextKey++,
    touched: false,
    sourceKey: "",
    table: "holding",
    address: "",
    type: "uint16",
    wordOrder: "big",
    byteSwap: false,
    scale: "1",
    offset: "0",
    unit: "",
  };
}

function rowOf(entry: DeviceProfileDto["registers"][number]): RowDraft {
  return {
    key: nextKey++,
    touched: false,
    sourceKey: entry.sourceKey,
    table: entry.table,
    address: String(entry.address),
    type: entry.type,
    wordOrder: entry.wordOrder,
    byteSwap: entry.byteSwap,
    scale: String(entry.scale),
    offset: String(entry.offset),
    unit: entry.unit ?? "",
  };
}

/** Empty text is not zero: it reaches the schema as `NaN`, which it refuses. */
function numberOf(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

/** The register a row would send, unchecked. */
function candidateOf(row: RowDraft): Record<string, unknown> {
  const unit = row.unit.trim();
  return {
    sourceKey: row.sourceKey,
    table: row.table,
    address: numberOf(row.address),
    type: row.type,
    wordOrder: row.wordOrder,
    byteSwap: row.byteSwap,
    scale: numberOf(row.scale),
    offset: numberOf(row.offset),
    ...(unit === "" ? {} : { unit }),
  };
}

const FIELD_LABELS: Record<string, string> = {
  sourceKey: "Source key",
  table: "Table",
  address: "Address",
  type: "Type",
  wordOrder: "Word order",
  byteSwap: "Byte swap",
  scale: "Scale",
  offset: "Offset",
  unit: "Unit",
};

type Checked = {
  registers: ModbusRegister[] | null;
  rowMessages: string[][];
  /** An issue of the list as a whole (none, or more than 256 rows): no row to mark. */
  listMessage: string | null;
};

/**
 * Checks each row with the shared `modbusRegisterSchema`, then the rows that
 * passed with `modbusRegistersSchema` for a `sourceKey` used twice, mapping its
 * issue back to the row on screen. The server's 400 is `flatten()`ed and loses
 * the index, so this is the only place a message can land on its row.
 */
function check(rows: readonly RowDraft[]): Checked {
  const rowMessages: string[][] = rows.map(() => []);
  const valid: { index: number; entry: ModbusRegister }[] = [];
  rows.forEach((row, index) => {
    const parsed = modbusRegisterSchema.safeParse(candidateOf(row));
    if (parsed.success) {
      valid.push({ index, entry: parsed.data });
      return;
    }
    for (const issue of parsed.error.issues) {
      const field = typeof issue.path[0] === "string" ? FIELD_LABELS[issue.path[0]] : undefined;
      rowMessages[index]?.push(field ? `${field}: ${issue.message}` : issue.message);
    }
  });
  // Counted on the rows on screen, not on the rows that passed: 257 rows with one bad row are
  // still too many, and the list check below sees only the passing ones.
  let listMessage: string | null =
    rows.length === 0
      ? "A profile needs at least one register."
      : rows.length > MODBUS_REGISTERS_MAX
        ? `A profile holds at most ${MODBUS_REGISTERS_MAX} registers.`
        : null;
  const list = modbusRegistersSchema.safeParse(valid.map((item) => item.entry));
  if (!list.success) {
    for (const issue of list.error.issues) {
      const at = issue.path[0];
      const row = typeof at === "number" ? valid[at] : undefined;
      if (row) rowMessages[row.index]?.push(`Source key: ${issue.message}`);
      else listMessage ??= issue.message;
    }
  }
  const clean =
    rowMessages.every((messages) => messages.length === 0) && listMessage === null && list.success;
  return { registers: clean ? valid.map((item) => item.entry) : null, rowMessages, listMessage };
}

/** The first message the shared field schema gives, or `null`. */
function fieldMessage(schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }, value: string): string | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? null : (parsed.error?.issues[0]?.message ?? "Invalid");
}

const sourceShape = deviceProfileSchema.shape.source.shape;

/**
 * `F1.2` (ADR 0141 decision 13, plan T6.1, rulings P2 and P12b) — the device
 * profile editor: the descriptive fields and the register list, edited as rows
 * of a table (P12b: no raw JSON, no CSV paste).
 *
 * **Save is always a new row.** An opened profile saves through
 * `POST /admin/device-profiles/:id/versions` with the opened row's version as
 * `baseVersion` (P2); there is no PATCH. A 409 means another save landed on
 * that code since the editor opened, and the editor says so and offers a
 * reload rather than retrying on top of it. A new profile is
 * `POST /admin/device-profiles`.
 */
export function DeviceProfileEditor({ organizationId, base, onClose, onReload }: DeviceProfileEditorProps) {
  const [fields, setFields] = useState<Fields>(() => ({
    code: "",
    vendor: base?.vendor ?? "",
    model: base?.model ?? "",
    document: base?.source.document ?? "",
    revision: base?.source.revision ?? "",
    pages: base?.source.pages ?? "",
  }));
  const [rows, setRows] = useState<RowDraft[]>(() => (base ? base.registers.map(rowOf) : [emptyRow()]));
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<{ stale: boolean; message: string } | null>(null);

  const createM = useCreateDeviceProfile();
  const saveM = useSaveDeviceProfileVersion();
  const pending = createM.isPending || saveM.isPending;

  const checked = check(rows);
  const fieldErrors: Partial<Record<keyof Fields, string | null>> = {
    code: base || deviceProfileCodeSchema.safeParse(fields.code.trim()).success ? null : CODE_RULE,
    vendor: fieldMessage(deviceProfileSchema.shape.vendor, fields.vendor),
    model: fieldMessage(deviceProfileSchema.shape.model, fields.model),
    document: fieldMessage(sourceShape.document, fields.document),
    revision: fieldMessage(sourceShape.revision, fields.revision),
    pages: fieldMessage(sourceShape.pages, fields.pages),
  };
  const fieldsValid = Object.values(fieldErrors).every((message) => message === null);

  function setField(name: keyof Fields, value: string): void {
    setFields((current) => ({ ...current, [name]: value }));
  }

  function updateRow(key: number, patch: Partial<RowDraft>): void {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch, touched: true } : row)));
  }

  function onFailure(error: unknown): void {
    if (base && error instanceof ApiError && error.status === 409) {
      setFailure({ stale: true, message: STALE_SAVE_SENTENCE });
      return;
    }
    setFailure({ stale: false, message: apiErrorMessage(error) });
  }

  function save(): void {
    setSubmitted(true);
    setFailure(null);
    if (!fieldsValid || checked.registers === null) return;
    const common = {
      vendor: fields.vendor.trim(),
      model: fields.model.trim(),
      source: { document: fields.document.trim(), revision: fields.revision.trim(), pages: fields.pages.trim() },
      registers: checked.registers,
    };
    if (base) {
      saveM.mutate(
        { id: base.id, body: { baseVersion: base.version, ...common } },
        { onSuccess: onClose, onError: onFailure },
      );
    } else {
      createM.mutate(
        { organizationId, code: fields.code.trim(), ...common },
        { onSuccess: onClose, onError: onFailure },
      );
    }
  }

  const textField = (name: keyof Fields, label: string) => {
    const message = submitted ? fieldErrors[name] : null;
    const id = `device-profile-${name}`;
    return (
      <div>
        <label htmlFor={id} className="block text-xs font-semibold text-ink-muted">
          {label}
        </label>
        <input
          id={id}
          className="mt-1 w-full surface-field px-3 py-2 text-sm"
          value={fields[name]}
          aria-invalid={message ? true : undefined}
          onChange={(event) => setField(name, event.target.value)}
        />
        {message ? <p className="mt-1 text-xs text-critical-ink">{message}</p> : null}
      </div>
    );
  };

  const title = base ? `Edit ${base.code} (from v${base.version})` : "New device profile";
  const cell = "px-1 py-1";
  const input = "w-full surface-field px-2 py-1 text-xs";

  return (
    <SectionCard
      title={title}
      subtitle={base ? "Saving writes a new version; the versions before it are kept unchanged." : "Saved as version 1."}
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          {base ? null : textField("code", "Code")}
          {textField("vendor", "Vendor")}
          {textField("model", "Model")}
          {textField("document", "Manual")}
          {textField("revision", "Revision")}
          {textField("pages", "Pages")}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-ink-muted">
                <th className="px-1 py-2">#</th>
                <th className="px-1 py-2">Source key</th>
                <th className="px-1 py-2">Table</th>
                <th className="px-1 py-2">Address</th>
                <th className="px-1 py-2">Type</th>
                <th className="px-1 py-2">Word order</th>
                <th className="px-1 py-2">Byte swap</th>
                <th className="px-1 py-2">Scale</th>
                <th className="px-1 py-2">Offset</th>
                <th className="px-1 py-2">Unit</th>
                <th className="px-1 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            {rows.map((row, index) => {
              const n = index + 1;
              const messages = submitted || row.touched ? (checked.rowMessages[index] ?? []) : [];
              const invalid = messages.length > 0;
              return (
                <tbody key={row.key} data-register-row={n} data-invalid={invalid ? "true" : undefined} className="border-b border-well-deep">
                  <tr>
                    <td className={`${cell} font-mono text-xs text-ink-muted`}>{n}</td>
                    <td className={cell}>
                      <input aria-label={`Source key, row ${n}`} className={`${input} font-mono`} value={row.sourceKey} onChange={(event) => updateRow(row.key, { sourceKey: event.target.value })} />
                    </td>
                    <td className={cell}>
                      <select aria-label={`Table, row ${n}`} className={input} value={row.table} onChange={(event) => updateRow(row.key, { table: event.target.value as ModbusTable })}>
                        {MODBUS_TABLES.map((table) => (
                          <option key={table} value={table}>{table}</option>
                        ))}
                      </select>
                    </td>
                    <td className={cell}>
                      <input type="number" aria-label={`Address, row ${n}`} className={input} value={row.address} onChange={(event) => updateRow(row.key, { address: event.target.value })} />
                    </td>
                    <td className={cell}>
                      <select aria-label={`Type, row ${n}`} className={input} value={row.type} onChange={(event) => updateRow(row.key, { type: event.target.value as ModbusValueType })}>
                        {MODBUS_VALUE_TYPES.map((type) => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </td>
                    <td className={cell}>
                      <select aria-label={`Word order, row ${n}`} className={input} value={row.wordOrder} onChange={(event) => updateRow(row.key, { wordOrder: event.target.value as ModbusWordOrder })}>
                        {MODBUS_WORD_ORDERS.map((order) => (
                          <option key={order} value={order}>{order}</option>
                        ))}
                      </select>
                    </td>
                    <td className={`${cell} text-center`}>
                      <input type="checkbox" aria-label={`Byte swap, row ${n}`} checked={row.byteSwap} onChange={(event) => updateRow(row.key, { byteSwap: event.target.checked })} />
                    </td>
                    <td className={cell}>
                      <input type="number" step="any" aria-label={`Scale, row ${n}`} className={input} value={row.scale} onChange={(event) => updateRow(row.key, { scale: event.target.value })} />
                    </td>
                    <td className={cell}>
                      <input type="number" step="any" aria-label={`Offset, row ${n}`} className={input} value={row.offset} onChange={(event) => updateRow(row.key, { offset: event.target.value })} />
                    </td>
                    <td className={cell}>
                      <input aria-label={`Unit, row ${n}`} className={input} value={row.unit} onChange={(event) => updateRow(row.key, { unit: event.target.value })} />
                    </td>
                    <td className={cell}>
                      <button type="button" aria-label={`Remove row ${n}`} className="text-xs font-semibold text-ink-muted" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                  {invalid ? (
                    <tr>
                      <td />
                      <td colSpan={10} className="px-1 pb-2 text-xs text-critical-ink">
                        <ul>
                          {messages.map((message, at) => (
                            <li key={at}>{message}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              );
            })}
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="surface-button px-3 py-2 text-xs font-semibold" onClick={() => setRows((current) => [...current, emptyRow()])}>
            Add register
          </button>
          <span className="flex-1" />
          <button type="button" className="surface-button px-3 py-2 text-xs font-semibold" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-60"
            disabled={pending}
            aria-busy={pending}
            onClick={save}
          >
            {pending ? "Saving…" : base ? "Save new version" : "Create profile"}
          </button>
        </div>

        {submitted && (!fieldsValid || checked.registers === null) ? (
          <p role="status" className="text-xs text-critical-ink">
            {checked.rowMessages.some((messages) => messages.length > 0)
              ? "Fix the marked rows before saving."
              : (checked.listMessage ?? "Fix the marked fields before saving.")}
          </p>
        ) : null}
        {failure ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-critical-ink">
            <span>{failure.message}</span>
            {failure.stale ? (
              <button type="button" className="surface-button px-3 py-1 text-xs font-semibold" onClick={onReload}>
                Reload
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
