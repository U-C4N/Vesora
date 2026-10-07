"""Create a self-contained viewer from an immutable scene and binary data."""
from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any


_TEMPLATE = Path(__file__).parent / "_assets" / "standalone.html"
_PLACEHOLDER = "__VESORA_PAYLOAD_JSON__"


def make_html(snapshot: dict[str, Any], buffers: list[tuple[str, bytes]]) -> str:
    """Embed the scene without interpreting any title, label, or note as HTML."""
    try:
        template = _TEMPLATE.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise RuntimeError("The bundled standalone.html asset is missing; rebuild or reinstall Vesora") from exc
    if template.count(_PLACEHOLDER) != 1:
        raise RuntimeError("The bundled standalone.html asset has an invalid payload placeholder")
    envelope = {
        "formatVersion": 1,
        "snapshot": snapshot,
        "buffers": [{"id": data_id, "base64": base64.b64encode(data).decode("ascii")} for data_id, data in buffers],
    }
    payload = json.dumps(envelope, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
    # JSON is placed inside a script element. Escaping HTML-sensitive characters
    # also covers closing script tags, comments, and unusual Unicode text.
    for char, escaped in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026")):
        payload = payload.replace(char, escaped)
    return template.replace(_PLACEHOLDER, payload)
