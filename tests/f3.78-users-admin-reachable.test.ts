import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const webSrc = join(repoRoot, "apps/web/src");

/**
 * `F3.78` (ADR 0089, plan U7) — the users screen is reachable, and only by the roles the API
 * admits. Static: three facts, each read from the source with comments stripped so prose naming
 * a symbol cannot satisfy a check.
 *
 * - R1: `app.tsx` declares `/admin/users` and renders `UsersAdminPage` inside `AdminRoute`.
 * - R2: `masterDataTabs` has a `Users` tab at that path, in the `access` area, flagged
 *   `usersAdmin`, and `visibleMasterDataTabs` reads that flag through `canManageUsers`.
 * - R3: the page fails closed: it calls `canManageUsers(user.role)` before it renders the screen.
 *
 * Each claim has a positive control that drives a mutated copy through the same function.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function read(relative: string): string {
  return withoutComments(readFileSync(join(webSrc, relative), "utf8"));
}

/** The `<Route path="/admin/users" …>` element, up to its closing `/>`. */
function usersRouteBlock(app: string): string {
  const start = app.indexOf('path="/admin/users"');
  if (start === -1) {
    return "";
  }
  const end = app.indexOf("/>", app.indexOf("element=", start));
  return end === -1 ? "" : app.slice(start, end);
}

function routeIsGuarded(app: string): boolean {
  const block = usersRouteBlock(app);
  return /<AdminRoute\b[^>]*>\s*<UsersAdminPage\b/.test(block);
}

function tabIsDeclared(access: string): boolean {
  return /\{\s*label:\s*"Users",\s*path:\s*"\/admin\/users",\s*usersAdmin:\s*true,\s*area:\s*"access"\s*\}/.test(access);
}

function tabFilterReadsThePredicate(access: string): boolean {
  return /"usersAdmin" in tab && tab\.usersAdmin\)\s*\{\s*return canManageUsers\(role\);/.test(access);
}

function pageFailsClosed(page: string): boolean {
  const gate = page.indexOf("canManageUsers(user.role)");
  const screen = page.indexOf("<UsersAdminScreen");
  return gate !== -1 && screen !== -1 && gate < screen && /if \(!canManageUsers\(user\.role\)\)/.test(page);
}

const app = read("app.tsx");
const access = read("lib/admin-access.ts");
const page = read("pages/admin/users-page.tsx");

describe("F3.78 users admin is reachable", () => {
  it("R1 app.tsx declares /admin/users inside AdminRoute", () => {
    expect(routeIsGuarded(app)).toBe(true);
  });

  it("R1 control: an unguarded route is not accepted", () => {
    expect(routeIsGuarded(app.replace(/<AdminRoute user=\{user\}>\s*<UsersAdminPage/, "<div><UsersAdminPage"))).toBe(false);
    expect(routeIsGuarded(app.replace('path="/admin/users"', 'path="/admin/people"'))).toBe(false);
  });

  it("R2 masterDataTabs has the Users tab in the access area with the usersAdmin flag", () => {
    expect(tabIsDeclared(access)).toBe(true);
  });

  it("R2 control: a tab without the flag is not accepted", () => {
    expect(tabIsDeclared(access.replace("usersAdmin: true, ", ""))).toBe(false);
  });

  it("R2 visibleMasterDataTabs gates the usersAdmin flag on canManageUsers", () => {
    expect(tabFilterReadsThePredicate(access)).toBe(true);
  });

  it("R2 control: a filter that does not read the predicate is not accepted", () => {
    expect(tabFilterReadsThePredicate(access.replace("return canManageUsers(role);", "return true;"))).toBe(false);
  });

  it("R3 the page fails closed on canManageUsers before it renders the screen", () => {
    expect(pageFailsClosed(page)).toBe(true);
  });

  it("R3 control: a page without the gate is not accepted", () => {
    expect(pageFailsClosed(page.replace("if (!canManageUsers(user.role))", "if (false)"))).toBe(false);
  });
});
