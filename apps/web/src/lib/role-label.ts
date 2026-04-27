import type { UserRole } from "@bms/shared";

/** Maps stored role slugs to human-readable labels for the chrome. */
export function roleLabel(role: UserRole): string {
  switch (role) {
    case "admin":
      return "Administrator";
    case "operator":
      return "Operator";
    case "viewer":
      return "Viewer";
    default:
      return role;
  }
}
