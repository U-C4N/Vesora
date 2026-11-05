"""Canonical protocol-9 inputs. Numerical preparation remains in the shared engine."""
from __future__ import annotations

import math
import sys
from typing import Any

from .numeric import NumericData, as_numeric

ADVANCED_PROTOCOL_VERSION = 9
KINDS = {"ecdf", "spectrogram", "eventTimeline", "errorbar", "contour", "quiver",
         "parallelCoordinates", "paretoFront", "phasePortrait", "ternary"}


def vector(value: Any, name: str) -> NumericData:
    result = as_numeric(value, name)
    if result.ndim != 1:
        raise ValueError(f"{name} must be one-dimensional")
    return result


def number(value: Any, name: str, *, positive: bool = False, nonnegative: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be finite")
    if positive and value <= 0 or nonnegative and value < 0:
        raise ValueError(f"{name} must be {'positive' if positive else 'nonnegative'}")
    return float(value)


def boolean(value: Any, name: str) -> bool:
    if type(value) is not bool:
        raise TypeError(f"{name} must be a boolean")
    return value


def _increasing(values: NumericData, name: str) -> None:
    previous = -math.inf
    for value in values:
        if not math.isfinite(value) or value <= previous:
            raise ValueError(f"{name} must be finite and strictly increasing")
        previous = value


def regular_cadence(values: Any) -> None:
    rows = list(values)
    if len(rows) < 3:
        return
    step = rows[1]-rows[0]
    for i in range(2, len(rows)):
        expected = rows[i-1]+step
        tolerance = max(1, abs(expected), abs(rows[i]))*sys.float_info.epsilon*16+abs(step)*1e-9
        if abs(rows[i]-expected) > tolerance:
            raise ValueError("Spectrogram time cadence must be regular; represent missing hops with explicit NaN rows")


def _lengths(arrays: dict[str, NumericData]) -> None:
    if len({value.size for value in arrays.values()}) > 1:
        raise ValueError("All channels must have matching lengths")


def _strings(values: Any, name: str, length: int | None = None) -> list[str]:
    if not isinstance(values, (list, tuple)) or any(not isinstance(v, str) for v in values):
        raise ValueError(f"{name} must contain strings")
    result = list(values)
    if length is not None and len(result) != length:
        raise ValueError(f"{name} must contain {length} entries")
    return result


ALIASES = {"max_rows": "maxRows", "value_scale": "valueScale", "db_reference": "dbReference", "db_floor": "dbFloor",
           "cap_size": "capSize", "head_size": "headSize", "show_all": "showAll"}
OPTION_KEYS = {
    "ecdf": {"complementary"}, "spectrogram": {"maxRows", "valueScale", "dbReference", "dbFloor", "sequenceStart", "sequenceEnd"},
    "eventTimeline": {"lanes", "labels", "eventIds"}, "errorbar": {"capSize"}, "contour": {"levels", "filled"},
    "quiver": {"scale", "normalize", "headSize"}, "parallelCoordinates": {"axes"},
    "paretoFront": {"objectives", "showAll", "connect"}, "phasePortrait": {"direction", "closed"},
    "ternary": {"sum", "normalize", "tolerance", "labels", "connect"},
}


def normalize_options(options: dict[str, Any]) -> dict[str, Any]:
    result = dict(options)
    for source, target in ALIASES.items():
        if source in result:
            if target in result:
                raise TypeError(f"Supply only one of {source} and {target}")
            result[target] = result.pop(source)
    return result


def options_for(kind: str, supplied: dict[str, Any], arrays: dict[str, NumericData]) -> dict[str, Any]:
    opts = normalize_options(supplied)
    unknown = opts.keys() - OPTION_KEYS[kind]
    if unknown:
        raise TypeError(f"Unknown {kind} options: {', '.join(sorted(unknown))}")
    if kind == "ecdf":
        return {"complementary": boolean(opts.get("complementary", False), "complementary")}
    if kind == "spectrogram":
        capacity = opts.get("maxRows", 256)
        if type(capacity) is not int or capacity < 1 or capacity > 2**32 - 1:
            raise ValueError("max_rows must be a positive integer at most 2**32 - 1")
        scale = opts.get("valueScale", "linear")
        if scale not in ("linear", "db"):
            raise ValueError("value_scale must be linear or db")
        return {"maxRows": capacity, "valueScale": scale,
                "dbReference": number(opts.get("dbReference", 1), "db_reference", positive=True),
                "dbFloor": number(opts.get("dbFloor", -120), "db_floor"),
                "sequenceStart": opts.get("sequenceStart", 0), "sequenceEnd": opts.get("sequenceEnd", arrays["y"].size)}
    if kind == "eventTimeline":
        return {"lanes": _strings(opts.get("lanes", []), "lanes"),
                "labels": _strings(opts.get("labels", []), "labels", arrays["x"].size),
                "eventIds": _strings(opts.get("eventIds", []), "eventIds", arrays["x"].size)}
    if kind == "errorbar":
        return {"capSize": number(opts.get("capSize", 6), "cap_size", nonnegative=True)}
    if kind == "contour":
        levels = opts.get("levels", 10)
        if type(levels) is int:
            if levels < 1 or levels > 1024:
                raise ValueError("levels must be an integer from 1 through 1024")
            finite = [value for value in arrays["z"] if math.isfinite(value)]
            lo, hi = (min(finite), max(finite)) if finite else (0, 1)
            if lo == hi:
                lo, hi = lo - 0.5, hi + 0.5
            levels = [lo + (hi - lo) * (i + 1) / (levels + 1) for i in range(levels)]
        else:
            levels = list(vector(levels, "levels"))
        _increasing(vector(levels, "levels"), "levels")
        if not levels or len(levels) > 1024:
            raise ValueError("From 1 through 1024 contour levels are required")
        return {"levels": levels, "filled": boolean(opts.get("filled", False), "filled")}
    if kind == "quiver":
        return {"scale": number(opts.get("scale", 1), "scale", positive=True),
                "normalize": boolean(opts.get("normalize", False), "normalize"),
                "headSize": number(opts.get("headSize", 6), "head_size", positive=True)}
    if kind == "parallelCoordinates":
        axes = opts.get("axes")
        if not isinstance(axes, (list, tuple)) or not 2 <= len(axes) <= 256 or len(axes) != len(arrays):
            raise ValueError("axes must describe every column")
        result = []
        keys = set()
        for axis in axes:
            if not isinstance(axis, dict) or axis.keys() - {"key", "label", "scale", "domain", "reverse"}:
                raise ValueError("Invalid parallel axis")
            key = axis.get("key")
            if not isinstance(key, str) or not key or key in keys:
                raise ValueError("Parallel axis keys must be unique nonempty strings")
            keys.add(key)
            label, scale = axis.get("label", key), axis.get("scale", "linear")
            if not isinstance(label, str) or scale not in ("linear", "log"):
                raise ValueError("Parallel axes need a string label and linear or log scale")
            item = {"key": key, "label": label, "scale": scale, "reverse": boolean(axis.get("reverse", False), "reverse")}
            if "domain" in axis:
                domain = list(vector(axis["domain"], "domain"))
                if len(domain) != 2 or not all(math.isfinite(v) for v in domain) or domain[0] >= domain[1] or scale == "log" and domain[0] <= 0:
                    raise ValueError("Invalid parallel axis domain")
                item["domain"] = domain
            result.append(item)
        return {"axes": result}
    if kind == "paretoFront":
        objectives = opts.get("objectives", ["min", "min"])
        if not isinstance(objectives, (list, tuple)) or len(objectives) != 2 or any(v not in ("min", "max") for v in objectives):
            raise ValueError("objectives must contain exactly two min/max entries")
        return {"objectives": list(objectives), "showAll": boolean(opts.get("showAll", True), "show_all"),
                "connect": boolean(opts.get("connect", True), "connect")}
    if kind == "phasePortrait":
        return {"direction": boolean(opts.get("direction", True), "direction"), "closed": boolean(opts.get("closed", False), "closed")}
    return {"sum": number(opts.get("sum", 1), "sum", positive=True),
            "normalize": boolean(opts.get("normalize", False), "normalize"),
            "tolerance": number(opts.get("tolerance", 1e-6), "tolerance", nonnegative=True),
            "labels": _strings(opts.get("labels", ["A", "B", "C"]), "labels", 3),
            "connect": boolean(opts.get("connect", False), "connect")}


def validate(kind: str, arrays: dict[str, NumericData], options: dict[str, Any]) -> None:
    if kind in ("spectrogram", "contour"):
        if set(arrays) != {"x", "y", "z"} or arrays["z"].shape != (arrays["y"].size, arrays["x"].size):
            raise ValueError("Grid shape must match [y, x]")
        _increasing(arrays["x"], "x")
        _increasing(arrays["y"], "y")
        if not arrays["x"].size or kind == "contour" and (arrays["x"].size < 2 or arrays["y"].size < 2):
            raise ValueError("Grid x must be nonempty; contour requires at least 2 by 2")
        if arrays["z"].size > 1_000_000:
            raise ValueError("Grid exceeds 1,000,000 retained cells")
        if kind == "spectrogram":
            regular_cadence(arrays["y"])
            if options["valueScale"] == "db" and any(math.isfinite(value) and value < 0 for value in arrays["z"]):
                raise ValueError("dB power inputs must be nonnegative")
            start, end = options["sequenceStart"], options["sequenceEnd"]
            if any(type(v) is not int or not 0 <= v <= 2**53 - 1 for v in (start, end)) or end - start != arrays["y"].size:
                raise ValueError("Spectrogram sequence interval must match retained rows")
            if arrays["y"].size > options["maxRows"]:
                raise ValueError("Spectrogram exceeds max_rows")
        return
    _lengths(arrays)
    if kind == "eventTimeline":
        if not options["lanes"] or any(not value for value in options["lanes"]) or len(set(options["lanes"])) != len(options["lanes"]) or any(not value for value in options["eventIds"]):
            raise ValueError("Lane names and event IDs must be nonempty; lane names must be unique")
        if len(set(options["eventIds"])) != len(options["eventIds"]):
            raise ValueError("Event IDs must be unique")
        for start, end, lane in zip(arrays["x"], arrays["end"], arrays["y"]):
            if not math.isfinite(start) or not math.isfinite(end) or end < start or lane != int(lane) or not 0 <= lane < len(options["lanes"]):
                raise ValueError("Invalid event interval or lane")
    elif kind == "errorbar":
        if "xLower" not in arrays and "yLower" not in arrays:
            raise ValueError("Provide at least one errorbar bound pair")
        for axis in "xy":
            if (axis + "Lower" in arrays) != (axis + "Upper" in arrays):
                raise ValueError("Errorbar bounds must be provided as lower/upper pairs")
            if axis + "Lower" in arrays:
                for center, lower, upper in zip(arrays[axis], arrays[axis + "Lower"], arrays[axis + "Upper"]):
                    if all(math.isfinite(v) for v in (center, lower, upper)) and not lower <= center <= upper:
                        raise ValueError("Errorbar bounds must contain their source center")
    elif kind == "phasePortrait":
        for name in ("time", "sequence"):
            if name in arrays:
                _increasing(arrays[name], name)
    elif kind == "ternary":
        for values in zip(arrays["a"], arrays["b"], arrays["c"]):
            if not all(math.isfinite(v) for v in values):
                continue
            total = sum(values)
            if min(values) < 0 or not math.isfinite(total) or total <= 0:
                raise ValueError("Ternary components must be nonnegative with a positive finite sum")
            if not options["normalize"] and abs(total - options["sum"]) > options["tolerance"]*options["sum"]:
                raise ValueError("Ternary components must match the declared sum; use normalize=True explicitly")


def prepare(kind: str, args: tuple[Any, ...], supplied: dict[str, Any]) -> tuple[dict[str, NumericData], dict[str, Any]]:
    opts = normalize_options(supplied)
    if kind == "eventTimeline":
        if len(args) != 1 or not isinstance(args[0], (list, tuple)):
            raise TypeError("event_timeline expects an event list")
        starts, ends, codes, labels, ids, lanes = [], [], [], [], [], []
        for i, event in enumerate(args[0]):
            if not isinstance(event, dict) or event.keys() - {"start", "end", "lane", "label", "id"}:
                raise ValueError("Invalid event")
            start = number(event.get("start"), "start")
            end = number(event.get("end", start), "end")
            lane, label, event_id = event.get("lane", "Events"), event.get("label", ""), event.get("id", str(i))
            if not all(isinstance(v, str) for v in (lane, label, event_id)) or not lane or not event_id:
                raise ValueError("Event lane, label and id must be strings")
            if lane not in lanes:
                lanes.append(lane)
            starts.append(start); ends.append(end); codes.append(lanes.index(lane)); labels.append(label); ids.append(event_id)
        arrays = {name: vector(value, name) for name, value in (("x", starts), ("y", codes), ("end", ends))}
        opts.update(lanes=lanes or ["Events"], labels=labels, eventIds=ids)
    elif kind == "parallelCoordinates":
        if len(args) != 1 or not isinstance(args[0], dict) or len(args[0]) < 2:
            raise ValueError("parallel_coordinates expects at least two named columns")
        columns = args[0]
        axes = opts.get("axes", [{"key": key} for key in columns])
        if not isinstance(axes, (list, tuple)) or len(axes) != len(columns) or {axis.get("key") for axis in axes if isinstance(axis, dict)} != set(columns):
            raise ValueError("Axes must reference each supplied column exactly once")
        arrays = {f"c{i}": vector(columns[axis["key"]], axis["key"]) for i, axis in enumerate(axes)}
        opts["axes"] = axes
    else:
        channels = {"ecdf": ("samples",), "spectrogram": ("y", "x", "z"), "errorbar": ("x", "y"),
                    "contour": ("x", "y", "z"), "quiver": ("x", "y", "u", "v"),
                    "paretoFront": ("x", "y"), "phasePortrait": ("x", "y"), "ternary": ("a", "b", "c")}[kind]
        if len(args) != len(channels):
            raise TypeError(f"{kind} expects {', '.join(channels)}")
        arrays = {name: as_numeric(value, name) if name == "z" else vector(value, name) for name, value in zip(channels, args)}
        extras = ("xLower", "xUpper", "yLower", "yUpper") if kind == "errorbar" else ("time", "sequence") if kind == "phasePortrait" else ()
        for name in extras:
            snake = "".join("_" + c.lower() if c.isupper() else c for c in name)
            if snake in opts and snake != name:
                if name in opts:
                    raise TypeError(f"Supply only one of {snake} and {name}")
                opts[name] = opts.pop(snake)
            if name in opts:
                arrays[name] = vector(opts.pop(name), name)
    options = options_for(kind, opts, arrays)
    if kind in ("spectrogram", "contour"):
        if arrays["z"].ndim == 1 and arrays["z"].size == arrays["y"].size*arrays["x"].size:
            arrays["z"] = NumericData(arrays["z"].dtype, (arrays["y"].size, arrays["x"].size), arrays["z"].tobytes())
        if arrays["z"].shape != (arrays["y"].size, arrays["x"].size):
            raise ValueError("Grid shape must match [y, x]")
        if kind == "spectrogram":
            regular_cadence(arrays["y"])
    if kind == "spectrogram" and arrays["y"].size > options["maxRows"]:
        rows, width = arrays["y"].size, arrays["x"].size
        retained = options["maxRows"]
        arrays["y"] = NumericData(arrays["y"].dtype, (retained,), arrays["y"].tobytes()[-retained * arrays["y"].dtype.itemsize:])
        arrays["z"] = NumericData(arrays["z"].dtype, (retained, width), arrays["z"].tobytes()[-retained * width * arrays["z"].dtype.itemsize:])
        options.update(sequenceStart=rows-retained, sequenceEnd=rows)
    validate(kind, arrays, options)
    return arrays, options


class AdvancedMethods:
    """Identical figure/panel entry points using the figure-owned source registry."""
    def _advanced_add(self, kind: str, args: tuple[Any, ...], options: dict[str, Any]) -> Any:
        owner = getattr(self, "figure", self)
        return owner._add_advanced(kind, args, options, panel_id=self.id if owner is not self else "main")

    def ecdf(self, samples: Any, **options: Any) -> Any:
        return self._advanced_add("ecdf", (samples,), options)

    def ccdf(self, samples: Any, **options: Any) -> Any:
        return self.ecdf(samples, **{**options, "complementary": True})

    def spectrogram(self, time: Any, frequency: Any, values: Any, **options: Any) -> Any:
        return self._advanced_add("spectrogram", (time, frequency, values), options)

    def event_timeline(self, events: Any, **options: Any) -> Any:
        return self._advanced_add("eventTimeline", (events,), options)

    def errorbar(self, x: Any, y: Any, **options: Any) -> Any:
        return self._advanced_add("errorbar", (x, y), options)

    def contour(self, x: Any, y: Any, z: Any, **options: Any) -> Any:
        return self._advanced_add("contour", (x, y, z), options)

    def contourf(self, x: Any, y: Any, z: Any, **options: Any) -> Any:
        return self.contour(x, y, z, **{**options, "filled": True})

    def quiver(self, x: Any, y: Any, u: Any, v: Any, **options: Any) -> Any:
        return self._advanced_add("quiver", (x, y, u, v), options)

    def parallel_coordinates(self, columns: Any, **options: Any) -> Any:
        return self._advanced_add("parallelCoordinates", (columns,), options)

    def pareto_front(self, x: Any, y: Any, **options: Any) -> Any:
        return self._advanced_add("paretoFront", (x, y), options)

    def phase_portrait(self, x: Any, y: Any, **options: Any) -> Any:
        return self._advanced_add("phasePortrait", (x, y), options)

    def hysteresis(self, x: Any, y: Any, **options: Any) -> Any:
        return self.phase_portrait(x, y, **options)

    def ternary(self, a: Any, b: Any, c: Any, **options: Any) -> Any:
        return self._advanced_add("ternary", (a, b, c), options)
