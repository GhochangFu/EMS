/**
 * @deprecated Use build-consolidated-docx.py (Pandoc) for Word-compatible output.
 * Converts platform-assessment-consolidated.md to .docx via Pandoc.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(__dirname, "build-consolidated-docx.py");
const result = spawnSync("python", [script], { stdio: "inherit" });
process.exit(result.status ?? 1);
