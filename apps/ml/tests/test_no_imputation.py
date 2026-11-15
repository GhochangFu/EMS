"""Static: no imputation anywhere under apps/ml/src (ADR 0135 Amendment 1, decision 3; plan R10).

A gap is NaN and stays NaN. This walks the syntax tree, not the text, so a
word in a docstring or comment is not a call, and an aliased import is still
caught.
"""

import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
FORBIDDEN = frozenset({"interpolate", "ffill", "bfill", "fillna", "nan_to_num", "backfill"})


def imputation_uses(source: str) -> list[str]:
    found = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Attribute) and node.attr in FORBIDDEN:
            found.append(node.attr)
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN:
            found.append(node.id)
        elif isinstance(node, ast.alias) and node.name.rsplit(".", 1)[-1] in FORBIDDEN:
            found.append(node.name)
    return found


def test_the_scan_finds_every_form_positive_control(tmp_path):
    sample = tmp_path / "bad.py"
    sample.write_text(
        "from numpy import nan_to_num as n\n"
        "import pandas\n"
        "s = pandas.Series([1.0])\n"
        "s.interpolate()\n"
        "s.ffill()\n"
        "x = s.bfill\n"
        "s.fillna(0)\n"
        "nan_to_num(1)\n",
        encoding="utf-8",
    )
    found = imputation_uses(sample.read_text(encoding="utf-8"))
    assert sorted(set(found)) == ["bfill", "ffill", "fillna", "interpolate", "nan_to_num"]


def test_a_docstring_mention_is_not_a_use():
    assert imputation_uses('"""we never interpolate or fillna"""\n# ffill\n') == []


def test_no_module_under_src_imputes():
    files = sorted(SRC.rglob("*.py"))
    assert files, "the scan found no source files"
    offenders = {
        str(path.relative_to(SRC)): uses
        for path in files
        if (uses := imputation_uses(path.read_text("utf-8")))
    }
    assert offenders == {}
