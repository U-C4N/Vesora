"""Validation and source adaptation for statistical layers (no statistics here).

All binning, quantiles and whiskers are computed by the shared TypeScript engine.
"""
from __future__ import annotations

import math
from numbers import Integral, Real
from typing import Any

from .numeric import NumericData, as_numeric


def vector(value: Any, name: str) -> NumericData:
    result = as_numeric(value, name)
    if result.ndim != 1:
        raise ValueError(f"{name} must be a 1D array")
    return result


def options(kind: str, values: dict[str, Any]) -> dict[str, Any]:
    values = dict(values)
    for source, target in (("bar_width", "barWidth"), ("box_width", "boxWidth")):
        if source in values:
            if target in values:
                raise TypeError(f"Supply only one of {source} and {target}")
            values[target] = values.pop(source)
    defaults = {
        "hist": {"bins": 10, "density": False, "cumulative": False},
        "bar": {"orientation": "vertical", "barWidth": 0.8},
        "boxplot": {"orientation": "vertical", "whis": 1.5, "showfliers": True, "boxWidth": 0.6},
    }
    allowed = set(defaults[kind]) | ({"range"} if kind == "hist" else set())
    if values.keys() - allowed:
        raise TypeError(f"Unknown {kind} option(s): {', '.join(sorted(values.keys() - allowed))}")
    result = {**defaults[kind], **values}
    if kind == "hist":
        bins = result["bins"]
        if isinstance(bins, Integral) and not isinstance(bins, bool):
            if bins < 1 or bins > 1_000_000:
                raise ValueError("bins must be an integer between 1 and 1000000")
            result["bins"] = int(bins)
        else:
            if isinstance(bins, (str, bool, Real)):
                raise TypeError("bins must be a positive integer or an edge array")
            edges = list(vector(bins, "bins"))
            if len(edges) < 2 or len(edges) > 1_000_001 or any(not math.isfinite(x) for x in edges) or any(a >= b for a, b in zip(edges, edges[1:])):
                raise ValueError("Bin edges must be finite and strictly increasing")
            result["bins"] = edges
        for name in ("density", "cumulative"):
            if not isinstance(result[name], bool):
                raise TypeError(f"{name} must be a boolean")
        if result.get("range") is None:
            result.pop("range", None)
        else:
            bounds = list(vector(result["range"], "range"))
            if len(bounds) != 2 or not all(math.isfinite(x) for x in bounds) or bounds[0] >= bounds[1]:
                raise ValueError("range must contain two increasing finite bounds")
            if not isinstance(result["bins"], int):
                raise ValueError("Explicit bin edges cannot be combined with range")
            result["range"] = bounds
    else:
        if result["orientation"] not in ("vertical", "horizontal"):
            raise ValueError("orientation must be 'vertical' or 'horizontal'")
        for name in ("barWidth",) if kind == "bar" else ("whis", "boxWidth"):
            value = result[name]
            if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value) or value < 0 or (name != "whis" and value == 0):
                raise ValueError(f"{name} must be finite and {'nonnegative' if name == 'whis' else 'positive'}")
            result[name] = float(value)
        if kind == "boxplot" and not isinstance(result["showfliers"], bool):
            raise TypeError("showfliers must be a boolean")
    return result


def baseline(value: Any, length: int) -> NumericData:
    if isinstance(value, Real) and not isinstance(value, bool):
        if not math.isfinite(value):
            raise ValueError("Baseline must be finite")
        value = [float(value)] * length
    result = vector(value, "baseline")
    if result.size != length or any(not math.isfinite(x) for x in result):
        raise ValueError("Baseline must be finite and match the bar count")
    return result


def groups(value: Any) -> list[NumericData]:
    if isinstance(value, (str, bytes, bytearray, dict)):
        raise TypeError("groups must contain numeric arrays")
    if isinstance(value, NumericData):
        numeric = value
    else:
        try:
            view = memoryview(value)
        except (ValueError, BufferError) as exc:
            raise TypeError("groups must contain real numeric values; unsupported buffer format") from exc
        except TypeError:
            numeric = None
        else:
            view.release()
            numeric = as_numeric(value, "groups")
    if numeric is not None:
        if numeric.ndim == 1:
            return [numeric]
        if numeric.ndim != 2:
            raise ValueError("groups must be a 1D array or a sequence of 1D arrays")
        size = numeric.shape[1] * numeric.dtype.itemsize
        raw = numeric.tobytes()
        return [NumericData(numeric.dtype, (numeric.shape[1],), raw[i * size:(i + 1) * size]) for i in range(numeric.shape[0])]
    entries = list(value)
    if not entries or all(isinstance(item, Real) for item in entries):
        return [vector(entries, "group")]
    return [vector(item, f"group {index}") for index, item in enumerate(entries)]


def labels(value: Any, count: int) -> list[str]:
    if value is None:
        return [str(i + 1) for i in range(count)]
    if isinstance(value, (str, bytes)):
        raise TypeError("labels must be a sequence of strings")
    result = list(value)
    if len(result) != count or any(not isinstance(item, str) for item in result):
        raise ValueError("labels must contain one string per group")
    if len(set(result)) != len(result):
        raise ValueError("Boxplot labels must be unique")
    return result
