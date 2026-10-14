"""Validate explicit PNG options without guessing the mounted viewer's DPR."""
from __future__ import annotations

import math
from typing import Any


MAX_EXPORT_PIXELS = 32_000_000


def _finite_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def png_options(*, width: int | None = None, height: int | None = None,
                scale: float | None = None) -> dict[str, Any]:
    """Return only supplied options; the renderer resolves omitted size and DPR."""
    if (width is None) != (height is None):
        raise ValueError("Export width and height must be supplied together")
    result: dict[str, Any] = {}
    if width is not None:
        for name, value, minimum in (("width", width, 200), ("height", height, 180)):
            if not _finite_number(value) or int(value) != value or not minimum <= value <= 2**53 - 1:
                raise ValueError(f"Export {name} must be a safe integer of at least {minimum}")
            result[name] = int(value)
    if scale is not None:
        if not _finite_number(scale) or scale <= 0:
            raise ValueError("Export scale must be positive and finite")
        result["scale"] = float(scale)
    if width is not None and scale is not None:
        # JavaScript Math.round is floor(n + .5) for these positive dimensions.
        raw_width, raw_height = width * scale, height * scale
        if not math.isfinite(raw_width) or not math.isfinite(raw_height):
            raise ValueError("Export raster dimensions must be finite")
        pixels_w, pixels_h = math.floor(raw_width + .5), math.floor(raw_height + .5)
        if pixels_w < 1 or pixels_h < 1:
            raise ValueError("Export raster dimensions must be at least one pixel")
        if pixels_w * pixels_h > MAX_EXPORT_PIXELS:
            raise ValueError("Export exceeds the 32 million pixel limit")
    return result
