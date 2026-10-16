import { z } from "zod";

import { MAX_MIMIC_SYMBOL_SVG_BYTES } from "../../contracts/mimic-symbol-libraries";
import {
  copilotMimicSymbolUploadModelBodySchema,
  createMimicOrgSymbolLibraryBodySchema,
  mimicSymbolUploadFieldsSchema,
  putMimicLibrarySettingBodySchema,
  updateMimicOrgSymbolBodySchema,
  updateMimicOrgSymbolLibraryBodySchema,
} from "../../contracts/mimic-symbol-library-writes";
import { fieldList, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, CatalogTarget, ExcludedRoute } from "./types";

/** The library services' authoring roles (ADR 0086 decision 7); the route's own check still runs on Confirm. */
const AUTHORS = ["admin", "organization_admin"] as const;

/** The organization library row the path names (`mimicSymbol.update` names its library; the route validates `symbolId`). */
const LIBRARY: CatalogTarget = { kind: "mimicLibrary", param: "id" };

/** A create or a built-in library setting: the body's `organizationId`, with the authoring check. */
const ORGANIZATION: CatalogTarget = { kind: "organization", manage: "mimic" };

/** The `:libraryCode` rule the controller parses it with (`mimicLibraryCodeParamSchema`; params are not bodies). */
const libraryCodeParam = z.string().min(1).max(32);

/** "Retire …" / "Reactivate …" for a patch that only flips `active`; else the fields it changes. */
function libraryPatchSummary(body: Readonly<Record<string, unknown>>, targetName: string): string {
  const keys = Object.keys(body);
  if (keys.length === 1 && body.active === false) return `Retire the symbol library ${quoted(targetName)}.`;
  if (keys.length === 1 && body.active === true) return `Reactivate the symbol library ${quoted(targetName)}.`;
  return `Change ${fieldList(body)} of the symbol library ${quoted(targetName)}.`;
}

/**
 * `F3.87` PR 6 (ADR 0099 Amendment 3 A1, A3) — the symbol library writes, for
 * the authoring roles. The symbol upload is the catalog's first multipart
 * entry (`upload`): the model sends the SVG as text in its `modelBody`, the
 * propose step parses it with the route's parser and stores the text under
 * the `cardOnly` key `svgText`, and on Confirm the browser sends it as the
 * `file` part, whose bytes the interceptor hashes (`fileSha256`). The
 * wizard's one step holds the text fields; the file sits beside it (plan D6).
 */
export const MIMIC_SYMBOL_LIBRARY_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "mimicLibrary.setting",
    title: "Turn a built-in symbol library on or off",
    method: "PUT",
    path: "/mimic-symbol-libraries/settings/:libraryCode",
    params: { libraryCode: libraryCodeParam },
    body: putMimicLibrarySettingBodySchema,
    bodyName: "putMimicLibrarySettingBodySchema",
    clientOnly: [],
    offeredTo: AUTHORS,
    risk: "edit",
    target: ORGANIZATION,
    refs: [],
    formulas: [],
    steps: [{ id: "setting", title: "Setting", fields: ["organizationId", "enabled"] }],
    summary: ({ body, params, organizationName }) =>
      `Turn the built-in symbol library ${quoted(params.libraryCode ?? "")} ${body.enabled === true ? "on" : "off"} for ${organizationName}.`,
  },
  {
    id: "mimicLibrary.create",
    title: "Create a symbol library",
    method: "POST",
    path: "/mimic-symbol-libraries",
    params: {},
    body: createMimicOrgSymbolLibraryBodySchema,
    bodyName: "createMimicOrgSymbolLibraryBodySchema",
    clientOnly: [],
    offeredTo: AUTHORS,
    risk: "create",
    target: ORGANIZATION,
    refs: [],
    formulas: [],
    steps: [
      { id: "library", title: "Library", fields: ["organizationId", "code", "label", "style"] },
      { id: "licence", title: "Licence", fields: ["licence", "attribution", "sourceUrl"] },
    ],
    summary: ({ body, organizationName }) =>
      `Create the symbol library ${quoted(text(body, "label"))} (org.${text(body, "code")}) in ${organizationName}.`,
  },
  {
    id: "mimicLibrary.update",
    title: "Edit a symbol library",
    method: "PATCH",
    path: "/mimic-symbol-libraries/:id",
    params: { id: uuidParam },
    body: updateMimicOrgSymbolLibraryBodySchema,
    bodyName: "updateMimicOrgSymbolLibraryBodySchema",
    clientOnly: [],
    offeredTo: AUTHORS,
    risk: "edit",
    target: LIBRARY,
    refs: [],
    formulas: [],
    steps: [
      { id: "details", title: "Details", fields: ["label", "licence", "attribution", "sourceUrl"] },
      { id: "status", title: "Status", fields: ["active"] },
    ],
    summary: ({ body, targetName }) => libraryPatchSummary(body, targetName),
  },
  {
    id: "mimicSymbol.update",
    title: "Edit a symbol",
    method: "PATCH",
    path: "/mimic-symbol-libraries/:id/symbols/:symbolId",
    params: { id: uuidParam, symbolId: uuidParam },
    body: updateMimicOrgSymbolBodySchema,
    bodyName: "updateMimicOrgSymbolBodySchema",
    clientOnly: [],
    offeredTo: AUTHORS,
    risk: "edit",
    target: LIBRARY,
    refs: [],
    formulas: [],
    steps: [{ id: "symbol", title: "Symbol", fields: ["label", "group", "active"] }],
    summary: ({ body, targetName }) => `Change ${fieldList(body)} of a symbol in the library ${quoted(targetName)}.`,
  },
  {
    id: "mimicSymbol.upload",
    title: "Upload a symbol",
    method: "POST",
    path: "/mimic-symbol-libraries/:id/symbols",
    params: { id: uuidParam },
    body: mimicSymbolUploadFieldsSchema,
    bodyName: "mimicSymbolUploadFieldsSchema",
    clientOnly: [],
    modelBody: copilotMimicSymbolUploadModelBodySchema,
    modelBodyName: "copilotMimicSymbolUploadModelBodySchema",
    offeredTo: AUTHORS,
    upload: { fileField: "file", contentType: "image/svg+xml", maxBytes: MAX_MIMIC_SYMBOL_SVG_BYTES },
    cardOnly: ["svgText"],
    risk: "create",
    target: LIBRARY,
    refs: [],
    formulas: [],
    steps: [{ id: "symbol", title: "Symbol", fields: ["name", "label", "group"] }],
    summary: ({ body, targetName }) =>
      `Upload the symbol ${quoted(text(body, "label") || text(body, "name"))} (${text(body, "name")}) to the library ${quoted(targetName)}.`,
  },
];

/** `F3.87` PR 6: every library route is now an entry; nothing waits on a later PR. */
export const MIMIC_SYMBOL_LIBRARY_PENDING: readonly ExcludedRoute[] = [];
