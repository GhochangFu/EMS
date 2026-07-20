#!/usr/bin/env python3
"""Build a Word-compatible .docx from platform-assessment-consolidated.md via Pandoc."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent
INPUT_MD = DOCS / "platform-assessment-consolidated.md"
OUTPUT_DOCX = DOCS / "platform-assessment-consolidated.docx"
REFERENCE_DOCX = DOCS / "scripts" / "pandoc-reference.docx"


def preprocess_markdown(text: str) -> str:
    """Replace Mermaid blocks with plain-text diagrams Pandoc can emit safely."""

    def replace_mermaid(block: re.Match[str]) -> str:
        body = block.group(0)
        if "flowchart TB" in body:
            lines = [
                "Architecture diagram (see markdown source for Mermaid):",
                "",
                "Edge: PLC (Modbus), SCADA (OPC-UA/BACnet), IoT (MQTT)",
                "  -> Ingest Adapter Framework -> Normalized Readings",
                "  -> TimescaleDB + Calculation Engine -> NestJS API",
                "  -> Socket.IO + Redis -> React SPA + Dashboard Builder",
                "Storage: TimescaleDB, PostgreSQL (bms.*), Object Storage (images)",
            ]
        elif "erDiagram" in body:
            lines = [
                "Entity relationship (see markdown source for Mermaid):",
                "",
                "organizations -> locations -> rtus -> assets -> asset_points",
                "organizations -> point_keys (catalog)",
                "assets -> alarms; automation_rules -> rule_executions",
                "telemetry.point_values (time, asset_id, point_key, value)",
            ]
        else:
            lines = ["(Diagram omitted in Word export; see markdown source.)"]
        return "```\n" + "\n".join(lines) + "\n```"

    return re.sub(r"```mermaid\n[\s\S]*?```", replace_mermaid, text)


def ensure_reference_doc() -> Path | None:
    """Create a Pandoc reference.docx once for consistent Word styling."""
    if REFERENCE_DOCX.exists():
        return REFERENCE_DOCX
    pandoc = shutil.which("pandoc")
    if not pandoc:
        return None
    REFERENCE_DOCX.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = subprocess.check_output(
            [pandoc, "--print-default-data-file=reference.docx"],
            stderr=subprocess.STDOUT,
        )
        REFERENCE_DOCX.write_bytes(data)
        return REFERENCE_DOCX
    except subprocess.CalledProcessError:
        return None


def main() -> int:
    if not INPUT_MD.is_file():
        print(f"Missing input: {INPUT_MD}", file=sys.stderr)
        return 1

    pandoc = shutil.which("pandoc")
    if not pandoc:
        print("Pandoc not found. Install from https://pandoc.org/installing.html", file=sys.stderr)
        return 1

    md = preprocess_markdown(INPUT_MD.read_text(encoding="utf-8"))

    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        suffix=".md",
        delete=False,
    ) as tmp:
        tmp.write(md)
        tmp_path = Path(tmp.name)

    cmd = [
        pandoc,
        str(tmp_path),
        "-o",
        str(OUTPUT_DOCX),
        "--from=markdown",
        "--to=docx",
        "--toc",
        "--toc-depth=3",
        "--standalone",
        "--metadata",
        "title=BMS Platform Assessment - Consolidated Report",
        "--metadata",
        "author=Eskom SMOC BMS",
        "--metadata",
        "date=2026-06-27",
    ]

    ref = ensure_reference_doc()
    if ref:
        cmd.extend(["--reference-doc", str(ref)])

    try:
        subprocess.run(cmd, check=True)
    finally:
        tmp_path.unlink(missing_ok=True)

    size = OUTPUT_DOCX.stat().st_size
    print(f"Wrote {OUTPUT_DOCX} ({size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
