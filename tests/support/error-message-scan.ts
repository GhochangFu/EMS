import { join, relative } from "node:path";

import * as ts from "typescript";

import { repoRoot, walk } from "./source-scan";

/*
 * The parser scan behind `tests/f4.204-raw-error-message-render.test.ts`: every place in
 * `apps/web/src` that reads the raw `.message` of an error, where the `apps/web/src/api` modules
 * put the response body. The shapes, the exemptions and what the scan cannot see are stated in
 * that test's header; this module holds the mechanism only.
 *
 * This directory holds no `*.test.ts`: a module here is imported rather than run, and it is
 * typechecked as an import of the file that uses it.
 */

export const WEB_SRC = join(repoRoot, "apps/web/src");

/** Repo-relative, forward slashes. */
export function rel(full: string): string {
  return relative(repoRoot, full).split("\\").join("/");
}

/**
 * Every `.ts` / `.tsx` file under `apps/web/src` the rule covers, repo-relative: not a spec, a
 * test or `test-setup.ts`, not a thrower under `api/`, and not `lib/api-error-message.ts` — the
 * one function that must read the raw text to parse it.
 */
export function scannedWebFiles(): string[] {
  return walk(WEB_SRC)
    .map(rel)
    .filter(
      (f) =>
        /\.tsx?$/.test(f) &&
        !/\.(spec|test)\.tsx?$/.test(f) &&
        !f.endsWith("/test-setup.ts") &&
        !f.startsWith("apps/web/src/api/") &&
        f !== "apps/web/src/lib/api-error-message.ts",
    )
    .sort();
}

/**
 * Raw reads that are not rendered raw. Matched on the file and the read's source text, never the
 * line, so an edit above the read does not stale the entry; `T5` fails an entry that matches
 * nothing or more than one read.
 */
export const RAW_READ_ALLOWLIST: readonly { file: string; read: string; why: string }[] = [
  {
    file: "apps/web/src/pages/admin/users-page.tsx",
    read: "err.message",
    why: "`JSON.parse` of the body to read the envelope's fields; the sentence is rendered through `apiErrorMessage`.",
  },
  {
    file: "apps/web/src/components/assets/asset-image-gallery.tsx",
    read: "query.error.message",
    why: "The body goes to `describeGalleryError`, which calls `apiErrorMessage` itself; a sentence there would read as 'Object storage is unavailable.'",
  },
  {
    file: "apps/web/src/components/assets/asset-images-panel.tsx",
    read: "cause.message",
    why: "The body goes to `describeAssetImageUploadError`, which calls `apiErrorMessage` itself.",
  },
];

/** `Error`, `ApiError`, `TypeError` and every other class name that ends in `Error`. */
const ERROR_TYPE = /^\w*Error$/;
/** `useQuery`, `useMutation`, `useInfiniteQuery`, and a named hook such as `useAlarmsQuery`. */
const QUERY_HOOK = /^use\w*(?:Query|Mutation)$/;
/** The TanStack fields that hold the query's or mutation's error (S5). */
const ERROR_FIELDS = new Set(["error", "failureReason"]);

/** What the error is read for: its `.message`, or its whole text through `String` or a template. */
type Read = "message" | "text";

/** Parentheses and `!` add nothing to a shape. */
function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
}

/** The member names of an annotation: `Error | null` is `["Error", "null"]`. */
function typeNames(node: ts.TypeNode | undefined, sf: ts.SourceFile): string[] {
  if (!node) return [];
  if (ts.isUnionTypeNode(node)) return node.types.map((t) => t.getText(sf));
  return [node.getText(sf)];
}

/** An annotation with an `Error` class among its members. */
function isErrorType(node: ts.TypeNode | undefined, sf: ts.SourceFile): boolean {
  return typeNames(node, sf).some((name) => ERROR_TYPE.test(name));
}

/**
 * S3: the function is an `onError` property or method, the argument of `.catch(…)`, or the
 * second argument of `.then(…)`. An `<img onError>` JSX attribute is an event, not an error.
 */
function isErrorCallback(fn: ts.SignatureDeclaration): boolean {
  if (ts.isMethodDeclaration(fn)) return fn.name.getText() === "onError";
  const parent = fn.parent;
  if (ts.isPropertyAssignment(parent) && parent.initializer === fn) return parent.name.getText() === "onError";
  if (ts.isCallExpression(parent)) {
    const index = parent.arguments.indexOf(fn as ts.Expression);
    const callee = parent.expression;
    if (index < 0 || !ts.isPropertyAccessExpression(callee)) return false;
    return (callee.name.text === "catch" && index === 0) || (callee.name.text === "then" && index === 1);
  }
  return false;
}

/**
 * A parameter named `name`: S2 by annotation, S3 by position, or an `error` prop destructured in
 * the parameter list. `undefined` when none is named so.
 *
 * `unknown` counts for a `.message` read only: a catch-all parameter read for its message is
 * nearly always an error, but `String(value: unknown)` is how a formatter prints any value. A
 * DTO parser that narrows `unknown` with a record guard and reads `.message` is a false positive
 * here; the allowlist is the way out.
 */
function classifyParameter(
  fn: ts.SignatureDeclaration,
  name: string,
  sf: ts.SourceFile,
  read: Read,
): boolean | undefined {
  for (const param of fn.parameters) {
    if (!ts.isObjectBindingPattern(param.name)) continue;
    const element = param.name.elements.find((el) => ts.isIdentifier(el.name) && el.name.text === name);
    if (element) return (element.propertyName?.getText(sf) ?? name) === "error" && read === "message";
  }
  const index = fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === name);
  if (index < 0) return undefined;
  const param = fn.parameters[index];
  if (param.type) {
    return isErrorType(param.type, sf) || (param.type.kind === ts.SyntaxKind.UnknownKeyword && read === "message");
  }
  return index === 0 && isErrorCallback(fn);
}

/** A variable named `name` declared in `statements`: S4 by annotation or cast, S6 by destructure. */
function classifyDeclared(statements: readonly ts.Statement[], name: string, sf: ts.SourceFile): boolean | undefined {
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        if (decl.name.text !== name) continue;
        if (decl.type) return isErrorType(decl.type, sf);
        const init = decl.initializer && unwrap(decl.initializer);
        return !!init && ts.isAsExpression(init) && isErrorType(init.type, sf);
      }
      if (ts.isObjectBindingPattern(decl.name)) {
        const element = decl.name.elements.find((el) => ts.isIdentifier(el.name) && el.name.text === name);
        if (!element) continue;
        const key = element.propertyName?.getText(sf) ?? name;
        const init = decl.initializer && unwrap(decl.initializer);
        const hook = init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) ? init.expression.text : "";
        return key === "error" && QUERY_HOOK.test(hook);
      }
    }
  }
  return undefined;
}

/** The nearest declaration of `id` decides its shape (S1–S4, S6); an unresolved name is not an error. */
function identifierIsError(id: ts.Identifier, sf: ts.SourceFile, read: Read): boolean {
  const name = id.text;
  for (let node: ts.Node | undefined = id.parent; node; node = node.parent) {
    if (ts.isCatchClause(node)) {
      const v = node.variableDeclaration;
      if (v && ts.isIdentifier(v.name) && v.name.text === name) return true;
    }
    if (ts.isFunctionLike(node)) {
      const shape = classifyParameter(node, name, sf, read);
      if (shape !== undefined) return shape;
    }
    if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      const shape = classifyDeclared(node.statements, name, sf);
      if (shape !== undefined) return shape;
    }
  }
  return false;
}

/** S4 a cast to an `Error` class, S5 a chain ending in `.error`/`.failureReason`, else the declaration. */
function isErrorShaped(expr: ts.Expression, sf: ts.SourceFile, read: Read): boolean {
  const e = unwrap(expr);
  if (ts.isAsExpression(e)) return isErrorType(e.type, sf);
  if (ts.isPropertyAccessExpression(e)) return ERROR_FIELDS.has(e.name.text);
  if (ts.isIdentifier(e)) return identifierIsError(e, sf, read);
  return false;
}

/** `file:line read` for every raw read of an error's text in `src`, in source order. */
export function rawErrorMessageReads(src: string, file: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const report = (node: ts.Node, text: string) =>
    out.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${text}`);

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "message" && isErrorShaped(node.expression, sf, "message")) {
      report(node, node.getText(sf));
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "String" &&
      node.arguments.length === 1 &&
      isErrorShaped(node.arguments[0], sf, "text")
    ) {
      report(node, node.getText(sf));
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "toString" &&
      node.arguments.length === 0 &&
      isErrorShaped(node.expression.expression, sf, "text")
    ) {
      report(node, node.getText(sf));
    } else if (ts.isTemplateSpan(node) && isErrorShaped(node.expression, sf, "text")) {
      report(node, `\${${node.expression.getText(sf)}}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
