import type { ZodTypeAny } from "zod";

import { jsonSchemaOf } from "../llm/tool-registry";
import { TOOL_RESULT_MAX_CHARS } from "../llm/tool-result";

/**
 * `F3.85` PR 8 — the body shape a propose tool takes, as the model reads it.
 *
 * A propose tool's definition inlines its body's JSON Schema only when it is
 * small ({@link INLINE_BODY_SCHEMA_MAX_CHARS}). The widget save and the two
 * template bodies run to 18–45 KB each, and every tool definition is sent on
 * every turn, so those three show a field list instead and the model reads
 * the shape on demand with `describe_change` — one level at a time, because a
 * tool result is cut at `TOOL_RESULT_MAX_CHARS`.
 */
export const INLINE_BODY_SCHEMA_MAX_CHARS = 3_000;

/** What `describe_change` returns at most, under the tool-result cut. */
const DESCRIBE_MAX_CHARS = TOOL_RESULT_MAX_CHARS - 1_000;

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node => value !== null && typeof value === "object" && !Array.isArray(value);

function membersOf(node: Node): Node[] {
  const members = node.anyOf ?? node.oneOf;
  return Array.isArray(members) ? members.filter(isNode) : [];
}

/** A union member's discriminator: the first property with a `const`. */
function discriminatorOf(member: Node): string | null {
  const properties = isNode(member.properties) ? member.properties : {};
  for (const property of Object.values(properties)) {
    if (isNode(property) && typeof property.const === "string") return property.const;
  }
  return null;
}

/**
 * The JSON Schema node at `path` below `root`. A step is a property name,
 * `[]` for an array's items, or a union member (its discriminator value, such
 * as a widget type, or its index). `null` when a step matches nothing.
 */
export function schemaNodeAt(root: Node, path: readonly string[]): Node | null {
  let node: Node = root;
  for (const step of path) {
    const members = membersOf(node);
    if (members.length > 0 && !isNode(node.properties)) {
      const byTag = members.find((member) => discriminatorOf(member) === step);
      const byIndex = /^\d+$/.test(step) ? members[Number(step)] : undefined;
      const next = byTag ?? byIndex;
      if (next === undefined) return null;
      node = next;
      continue;
    }
    if (step === "[]") {
      if (!isNode(node.items)) return null;
      node = node.items;
      continue;
    }
    const properties = isNode(node.properties) ? node.properties : null;
    const next = properties?.[step];
    if (!isNode(next)) return null;
    node = next;
  }
  return node;
}

/** One level of a node: each property's type, or each union member's tag, never the nested schema. */
export function outlineOf(node: Node): Node {
  const members = membersOf(node);
  if (members.length > 0 && !isNode(node.properties)) {
    return { anyOf: members.map((member, index) => discriminatorOf(member) ?? String(index)) };
  }
  if (isNode(node.items)) {
    return { type: "array", items: outlineOf(node.items) };
  }
  const properties = isNode(node.properties) ? node.properties : {};
  const outline: Record<string, string> = {};
  for (const [name, property] of Object.entries(properties)) {
    if (!isNode(property)) continue;
    const kind = membersOf(property).length > 0 ? "union" : String(property.type ?? "any");
    outline[name] = kind;
  }
  return {
    type: node.type ?? "object",
    properties: outline,
    required: Array.isArray(node.required) ? node.required : [],
  };
}

/** `describe_change`'s answer: the node in full when it fits, else its outline and how to go deeper. */
export function describeBody(body: ZodTypeAny, path: readonly string[]): { ok: true; schema: Node; outline: boolean } | { ok: false } {
  const node = schemaNodeAt(jsonSchemaOf(body), path);
  if (node === null) return { ok: false };
  if (JSON.stringify(node).length <= DESCRIBE_MAX_CHARS) return { ok: true, schema: node, outline: false };
  return { ok: true, schema: outlineOf(node), outline: true };
}

/**
 * One line per top-level field of a large body: its type, and for an array of
 * union members (the widgets) or a union, the member tags and the exact path
 * that reads one. The model then reads the one member it needs in a single
 * `describe_change` call — a live follow-up turn (2026-10-11) explored the
 * widget shape level by level until it hit the eight-call cap.
 */
export function fieldHintsOf(schema: Node, fields: readonly string[]): string[] {
  const properties = isNode(schema.properties) ? schema.properties : {};
  return fields.map((field) => {
    const property = properties[field];
    if (!isNode(property)) return field;
    const items = isNode(property.items) ? property.items : null;
    const unionOf = (node: Node) => membersOf(node).map((member, index) => discriminatorOf(member) ?? String(index));
    if (items !== null && membersOf(items).length > 0) {
      return `${field}: array of one of [${unionOf(items).join(", ")}]; read one with path ["${field}", "[]", "<member>"]`;
    }
    if (membersOf(property).length > 0) return `${field}: one of [${unionOf(property).join(", ")}]`;
    return `${field}: ${String(property.type ?? "object")}${items !== null ? ` of ${String(items.type ?? "object")}` : ""}`;
  });
}

/** The `body` property of a propose tool's definition: the schema itself when small, else a field guide. */
export function bodyDefinitionOf(body: ZodTypeAny, catalogId: string, fields: readonly string[]): Node {
  const schema = jsonSchemaOf(body);
  if (JSON.stringify(schema).length <= INLINE_BODY_SCHEMA_MAX_CHARS) return schema;
  return {
    type: "object",
    description:
      `The request body. Its full shape is large; read only the part you need with describe_change ` +
      `(catalogId "${catalogId}" and a path), once, then propose. Fields — ${fieldHintsOf(schema, fields).join("; ")}.`,
  };
}
