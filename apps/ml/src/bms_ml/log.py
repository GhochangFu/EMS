"""Logging: one JSON object per line on stdout (plan T3.9).

Fields come only from our own code. A record's `exc_info` is dropped on
purpose: a traceback carries the exception message, and a driver message can
carry a DSN, a host or row values (AGENTS.md §9.6). A failure is logged as a
stage and an exception class name, never as the exception's text.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any, TextIO

_LOGGER = logging.getLogger("bms_ml")
_LEVELS = {"debug": logging.DEBUG, "info": logging.INFO, "warning": logging.WARNING, "error": logging.ERROR}


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "event": record.msg,
        }
        payload.update(getattr(record, "fields", {}))
        return json.dumps(payload, default=str, separators=(",", ":"))


def configure(level: str = "info", stream: TextIO | None = None) -> None:
    handler = logging.StreamHandler(stream if stream is not None else sys.stdout)
    handler.setFormatter(_JsonFormatter())
    _LOGGER.handlers[:] = [handler]
    _LOGGER.setLevel(_LEVELS[level])
    _LOGGER.propagate = False


def event(name: str, level: str = "info", **fields: Any) -> None:
    """Log one event. `fields` must be counts, ids, codes or fixed strings: never a message."""
    _LOGGER.log(_LEVELS[level], name, extra={"fields": fields})
