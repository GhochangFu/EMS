import { pathToFileURL } from "node:url";

import { shouldAutoOpenPreview } from "./onboarding-preview-auto-open";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Unit checks for preview auto-open behaviour. */
export function runOnboardingPreviewAutoOpenTests(): void {
  assert(
    shouldAutoOpenPreview({
      autoOpenPreview: true,
      autoOpenReason: "review",
    }),
    "review opens",
  );
  assert(
    !shouldAutoOpenPreview({
      autoOpenPreview: true,
      autoOpenReason: "review",
      dismissedReason: "review",
    }),
    "dismiss blocks same reason",
  );
  assert(
    shouldAutoOpenPreview({
      autoOpenPreview: true,
      autoOpenReason: "validation_errors",
      dismissedReason: "review",
    }),
    "new reason opens after dismiss",
  );
}

const isMain =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  runOnboardingPreviewAutoOpenTests();
  process.stdout.write("onboarding-preview-auto-open tests: ok\n");
}
