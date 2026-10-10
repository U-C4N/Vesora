"""Declarative Python facade. Rendering is performed exclusively by the JS engine."""
from __future__ import annotations

import copy
import math
import re
import threading
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable

from .numeric import NumericData, as_numeric, numeric_range
from . import statistics as _statistics

PROTOCOL_VERSION = 1
EXTENDED_PROTOCOL_VERSION = 2
STATISTICS_PROTOCOL_VERSION = 3
_STYLES = {"color", "size", "width", "opacity", "label", "colormap", "representation", "colorDomain"}


def _default_host() -> str:
    try:
        from IPython import get_ipython
        shell = get_ipython()
        if shell is not None and (shell.__class__.__name__ == "ZMQInteractiveShell" or getattr(shell, "kernel", None) is not None):
            return "notebook"
    except ImportError:
        pass
    return "desktop"


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _array(value: Any, name: str) -> NumericData:
    return as_numeric(value, name)


def _domain(value: Any, name: str, scale: str = "linear") -> list[float]:
    if len(value) != 2:
        raise ValueError(f"{name} must have two bounds")
    result = [float(value[0]), float(value[1])]
    if not all(math.isfinite(v) for v in result) or result[0] >= result[1]:
        raise ValueError(f"{name} must contain increasing finite bounds")
    if scale == "log" and result[0] <= 0:
        raise ValueError(f"{name} must be positive for a logarithmic axis")
    return result


def _view(value: Any, kind: str) -> dict[str, Any]:
    """Validate and copy a complete view, including optional auto domains."""
    if not isinstance(value, dict) or value.get("kind") != kind:
        raise ValueError("View cannot change figure dimensionality")
    view = copy.deepcopy(value)
    for axis in "xyz":
        scale = view.get(f"{axis}Scale")
        if scale not in ("linear", "log"):
            raise ValueError("Invalid viewer scale")
        key = f"{axis}Domain"
        if view.get(key) is None:
            view.pop(key, None)
        else:
            view[key] = _domain(view[key], key, scale)
        if not isinstance(view.get(f"{axis}Label"), str):
            raise ValueError("Viewer labels must be strings")
    camera = view.get("camera")
    if not isinstance(camera, dict) or set(camera) != {"azimuth", "elevation", "distance"}:
        raise ValueError("Invalid viewer camera")
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in camera.values()) or camera["distance"] <= 0:
        raise ValueError("Camera values must be finite and distance positive")
    pan = view.get("pan3d", [0, 0])
    if not isinstance(pan, (list, tuple)) or len(pan) != 2 or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in pan):
        raise ValueError("3D pan must contain two finite numbers")
    view["pan3d"] = list(pan)
    return view


def _bookmark_name(name: Any) -> str:
    if not isinstance(name, str):
        raise TypeError("Bookmark name must be a string")
    name = name.strip()
    if not name:
        raise ValueError("Bookmark name must not be empty")
    return name


def _style(values: dict[str, Any]) -> dict[str, Any]:
    result = dict(values)
    if "color_domain" in result:
        result["colorDomain"] = result.pop("color_domain")
    unknown = result.keys() - _STYLES
    if unknown:
        raise TypeError(f"Unknown style option(s): {', '.join(sorted(unknown))}")
    for key in ("color", "label"):
        if key in result and not isinstance(result[key], str):
            raise TypeError(f"{key} must be a string")
    if "color" in result and result["color"].lower() not in {"blue", "red", "green", "orange", "purple", "black", "white", "cyan", "yellow"} and not re.fullmatch(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})", result["color"]):
        raise ValueError("Colors must be #RGB, #RRGGBB or a supported named color")
    for key in ("size", "width", "opacity"):
        if key in result:
            result[key] = float(result[key])
            if not math.isfinite(result[key]) or result[key] < 0 or (key != "opacity" and result[key] == 0):
                raise ValueError(f"{key} must be finite and {'nonnegative' if key == 'opacity' else 'positive'}")
    if result.get("opacity", 1) > 1:
        raise ValueError("opacity must be between zero and one")
    if "colormap" in result and result["colormap"] not in ("viridis", "magma"):
        raise ValueError("colormap must be 'viridis' or 'magma'")
    if "representation" in result and result["representation"] not in ("auto", "points", "density"):
        raise ValueError("representation must be 'auto', 'points', or 'density'")
    if "colorDomain" in result:
        result["colorDomain"] = _domain(result["colorDomain"], "color_domain")
    return result


def _annotation(kind: str, values: dict[str, Any]) -> dict[str, Any]:
    """Validate a complete annotation before committing any scene changes."""
    coordinates = {"text": {"x", "y", "text"}, "hline": {"y"}, "vline": {"x"}}[kind]
    style_names = {"color", "width", "opacity", "fontSize"}
    values = dict(values)
    if "font_size" in values:
        values["fontSize"] = values.pop("font_size")
    unknown = values.keys() - coordinates - style_names
    if unknown:
        raise TypeError(f"Unknown annotation option(s): {', '.join(sorted(unknown))}")
    result: dict[str, Any] = {}
    for name in coordinates:
        value = values.get(name)
        if name == "text":
            if not isinstance(value, str):
                raise TypeError("Annotation text must be a string")
        else:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"Annotation {name} must be finite")
            value = float(value)
        result[name] = value
    for name in ("width", "opacity", "fontSize"):
        if name in values and (isinstance(values[name], bool) or not isinstance(values[name], (int, float))):
            raise TypeError(f"Annotation {name} must be a number")
    style = _style({name: value for name, value in values.items() if name in {"color", "width", "opacity"}})
    if "fontSize" in values:
        size = values["fontSize"]
        if isinstance(size, bool) or not isinstance(size, (int, float)) or not math.isfinite(size) or size <= 0:
            raise ValueError("Annotation font_size must be positive and finite")
        style["fontSize"] = float(size)
    result["style"] = style
    return result


def _prepare(kind: str, *args: Any, **kwargs: Any) -> dict[str, NumericData]:
    colors = kwargs.pop("color", kwargs.pop("values", None))
    if kind in ("line", "scatter"):
        if len(args) == 1:
            y = _array(args[0], "y")
            args = (numeric_range(y.size), y)
        if len(args) != 2:
            raise TypeError(f"{kind} expects y or x, y")
        values = {"x": _array(args[0], "x"), "y": _array(args[1], "y")}
    elif kind == "scatter3d":
        if len(args) != 3:
            raise TypeError("scatter3d expects x, y, z")
        values = {k: _array(v, k) for k, v in zip(("x", "y", "z"), args)}
    else:
        if len(args) == 1:
            z = _array(args[0], "z")
            if z.ndim != 2:
                raise ValueError(f"{kind} z must be a 2D array")
            x = kwargs.pop("x", None)
            y = kwargs.pop("y", None)
            values = {"x": numeric_range(z.shape[1]) if x is None else _array(x, "x"),
                      "y": numeric_range(z.shape[0]) if y is None else _array(y, "y"), "z": z}
        elif len(args) == 3:
            values = {k: _array(v, k) for k, v in zip(("x", "y", "z"), args)}
        else:
            raise TypeError(f"{kind} expects z or x, y, z")
    if kwargs:
        raise TypeError(f"Unknown data arguments: {', '.join(kwargs)}")
    if kind in ("line", "scatter", "scatter3d"):
        if any(a.ndim != 1 for a in values.values()):
            raise ValueError(f"{kind} coordinates must be 1D arrays")
        if len({a.size for a in values.values()}) != 1:
            raise ValueError("Coordinate arrays must have matching lengths")
    else:
        x, y, z = values["x"], values["y"], values["z"]
        if x.ndim != 1 or y.ndim != 1 or z.ndim != 2 or z.shape != (y.size, x.size):
            raise ValueError("Grid requires 1D x/y and z.shape == (len(y), len(x))")
        minimum = 2 if kind == "surface" else 1
        if x.size < minimum or y.size < minimum:
            raise ValueError(f"{kind} needs at least {minimum} coordinate(s) on each axis")
        for name, a in (("x", x), ("y", y)):
            previous = -math.inf
            for value in a:
                if not math.isfinite(value) or value <= previous:
                    raise ValueError(f"Grid {name} coordinates must be finite and strictly increasing")
                previous = value
    if colors is not None:
        if kind in ("heatmap", "surface"):
            raise ValueError("Grid colors are determined by z; separate scalar colors are not supported")
        color = _array(colors, "color")
        expected = values["z"].shape if kind in ("heatmap", "surface") else values["x"].shape
        if color.shape != expected:
            raise ValueError("Scalar colors must match the coordinate data shape")
        values["color"] = color
    return values


class Layer:
    """Mutable handle; setters atomically publish a new shared-engine snapshot."""
    def __init__(self, figure: Figure, layer_id: str):
        self.figure, self.id = figure, layer_id

    def _spec(self) -> dict[str, Any]:
        self.figure._ensure_open()
        for layer in self.figure._spec["layers"]:
            if layer["id"] == self.id:
                return layer
        raise RuntimeError("Layer has been removed")

    def set_data(self, *args: Any, **kwargs: Any) -> Layer:
        if self._spec()["kind"] in ("hist", "bar", "boxplot", "line", "scatter"):
            self.figure._update_layer_data(self._spec(), args, kwargs)
            return self
        with self.figure._lock:
            layer = self._spec()
            current = {name: self.figure._sources[data_id][1] for name, data_id in layer["data"].items()}
            if not args:
                if "values" in kwargs:
                    kwargs["color"] = kwargs.pop("values")
                unknown = kwargs.keys() - {"x", "y", "z", "color"}
                if unknown:
                    raise TypeError(f"Unknown data channels: {', '.join(unknown)}")
                changed = set(kwargs)
                current.update(kwargs)
                names = ("x", "y", "z") if layer["kind"] in ("surface", "heatmap", "scatter3d") else ("x", "y")
                arrays = _prepare(layer["kind"], *(current[name] for name in names), color=current.get("color"))
            else:
                arrays = _prepare(layer["kind"], *args, **kwargs)
                changed = set(arrays)
                if "color" not in arrays and "color" in current:
                    if current["color"].shape != arrays["x"].shape:
                        raise ValueError("Update scalar colors when changing the point count")
                    arrays["color"] = current["color"]
            for name in changed:
                array = arrays[name]
                data_id = layer["data"].get(name, _id("data"))
                old = self.figure._sources.get(data_id)
                version = old[0]["version"] + 1 if old else 1
                layer["data"][name] = data_id
                self.figure._sources[data_id] = (self.figure._descriptor(data_id, array, version), array)
        self.figure._publish()
        return self

    def set_options(self, **options: Any) -> Layer:
        with self.figure._lock:
            previous = self._spec()
            if previous["kind"] not in ("hist", "bar", "boxplot"):
                raise TypeError("set_options is only supported by statistical layers")
            for source, target in (("bar_width", "barWidth"), ("box_width", "boxWidth")):
                if source in options:
                    if target in options:
                        raise TypeError(f"Supply only one of {source} and {target}")
                    options[target] = options.pop(source)
            next_options = _statistics.options(previous["kind"], {**previous["options"], **options})
            if next_options.get("orientation") != previous["options"].get("orientation"):
                raise ValueError("Layer orientation cannot change after creation")
            candidate = {**previous, "options": next_options}
            self.figure._validate_layer_candidate(candidate, self.figure._layer_arrays(previous), self.figure._spec.get("categories", {}))
            previous["options"] = next_options
        self.figure._publish()
        return self

    def set_style(self, **style: Any) -> Layer:
        validated = _style(style)
        with self.figure._lock:
            self._spec()["style"].update(validated)
        self.figure._publish()
        return self

    def set_visible(self, visible: bool) -> Layer:
        with self.figure._lock:
            self._spec()["visible"] = bool(visible)
        self.figure._publish()
        return self

    def remove(self) -> None:
        with self.figure._lock:
            spec = self._spec()
            self.figure._spec["layers"].remove(spec)
            for data_id in spec["data"].values():
                self.figure._sources.pop(data_id, None)
        self.figure._publish()


class Annotation:
    """Mutable data-coordinate annotation belonging to one figure panel."""

    def __init__(self, figure: Figure, annotation_id: str):
        self.figure, self.id = figure, annotation_id

    def _spec(self) -> dict[str, Any]:
        self.figure._ensure_open()
        for annotation in self.figure._spec.get("annotations", []):
            if annotation["id"] == self.id:
                return annotation
        raise RuntimeError("Annotation has been removed")

    def update(self, **options: Any) -> Annotation:
        with self.figure._lock:
            previous = self._spec()
            values = {key: value for key, value in previous.items() if key in {"x", "y", "text"}}
            values.update(previous["style"])
            values.update(options)
            validated = _annotation(previous["kind"], values)
            previous.update(validated)
        self.figure._publish()
        return self

    def remove(self) -> None:
        with self.figure._lock:
            annotation = self._spec()
            self.figure._spec["annotations"].remove(annotation)
            if not self.figure._spec["annotations"]:
                self.figure._spec.pop("annotations")
        self.figure._publish()


class Panel:
    """A lightweight handle; data, hosts and exports belong to its figure."""

    def __init__(self, figure: Figure, panel_id: str):
        self.figure, self.id = figure, panel_id

    def plot(self, *args: Any, **style: Any) -> Layer:
        return self.figure._add("line", args, style, panel_id=self.id)

    def scatter(self, x: Any, y: Any, **style: Any) -> Layer:
        return self.figure._add("scatter", (x, y), style, panel_id=self.id)

    def heatmap(self, *args: Any, **style: Any) -> Layer:
        return self.figure._add("heatmap", args, style, panel_id=self.id)

    def hist(self, samples: Any, **options: Any) -> Layer:
        return self.figure._add_statistics("hist", (samples,), options, self.id)

    def bar(self, x: Any, values: Any, **options: Any) -> Layer:
        return self.figure._add_statistics("bar", (x, values), {**options, "orientation": "vertical"}, self.id)

    def barh(self, y: Any, values: Any, **options: Any) -> Layer:
        return self.figure._add_statistics("bar", (y, values), {**options, "orientation": "horizontal"}, self.id)

    def boxplot(self, groups: Any, **options: Any) -> Layer:
        return self.figure._add_statistics("boxplot", (groups,), options, self.id)

    def set_categories(self, axis: str, labels: Any) -> Panel:
        self.figure._set_categories(self.id, axis, labels)
        return self

    def set_bar_mode(self, mode: str) -> Panel:
        self.figure._set_bar_mode(self.id, mode)
        return self

    def set_title(self, title: str) -> Panel:
        with self.figure._lock:
            self.figure._ensure_open()
            if "panels" in self.figure._spec:
                self.figure._panel_spec(self.id)["title"] = str(title)
            else:
                self.figure._spec["title"] = str(title)
        self.figure._publish()
        return self

    def set_axes(self, **options: Any) -> Panel:
        self.figure._set_panel_axes(self.id, options)
        return self

    def text(self, x: float, y: float, text: str, **style: Any) -> Annotation:
        return self.figure._add_annotation("text", {**style, "x": x, "y": y, "text": text}, self.id)

    def axhline(self, y: float, **style: Any) -> Annotation:
        return self.figure._add_annotation("hline", {**style, "y": y}, self.id)

    def axvline(self, x: float, **style: Any) -> Annotation:
        return self.figure._add_annotation("vline", {**style, "x": x}, self.id)


class Figure:
    def __init__(self, *, title: str = "", width: int = 800, height: int = 520, kind: str = "2d"):
        if kind not in ("2d", "3d"):
            raise ValueError("kind must be '2d' or '3d'")
        if isinstance(width, bool) or isinstance(height, bool) or not math.isfinite(width) or not math.isfinite(height) or int(width) != width or int(height) != height or width < 200 or height < 180:
            raise ValueError("width and height must be integers of at least 200 × 180")
        self.id = _id("figure")
        self._lock = threading.RLock()
        self._spec = {"protocolVersion": PROTOCOL_VERSION, "id": self.id, "title": str(title),
                      "width": int(width), "height": int(height), "view": {
                          "kind": kind, "xScale": "linear", "yScale": "linear", "zScale": "linear",
                          "xLabel": "", "yLabel": "", "zLabel": "",
                          "camera": {"azimuth": 35, "elevation": 25, "distance": 3}, "pan3d": [0, 0]}, "layers": []}
        self._sources: dict[str, tuple[dict[str, Any], NumericData]] = {}
        self._listeners: list[Callable[[], None]] = []
        self._events: dict[str, list[Callable[[Any], None]]] = defaultdict(list)
        self._host = None
        self._window = None
        self._widget = None
        self._closed = False

    def _ensure_open(self) -> None:
        if self._closed:
            raise RuntimeError("Figure is closed")

    def _set_layout(self, rows: int, cols: int, *, sharex: bool, sharey: bool) -> None:
        if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in (rows, cols)):
            raise ValueError("Subplot rows and cols must be positive integers")
        if not isinstance(sharex, bool) or not isinstance(sharey, bool):
            raise TypeError("sharex and sharey must be booleans")
        with self._lock:
            self._ensure_open()
            if self._spec["view"]["kind"] != "2d":
                raise ValueError("Subplots support 2D figures only")
            self._spec["protocolVersion"] = max(self._spec["protocolVersion"], EXTENDED_PROTOCOL_VERSION)
            self._spec["layout"] = {"rows": rows, "cols": cols, "shareX": sharex, "shareY": sharey}
            panels = []
            for row in range(rows):
                for col in range(cols):
                    panel = {"id": "main" if row == col == 0 else f"panel-{row}-{col}", "row": row, "col": col, "title": ""}
                    if row or col:
                        panel["view"] = copy.deepcopy(self._spec["view"])
                    panels.append(panel)
            self._spec["panels"] = panels

    def _panel_spec(self, panel_id: str) -> dict[str, Any]:
        for panel in self._spec.get("panels", []):
            if panel["id"] == panel_id:
                return panel
        raise ValueError(f"Unknown panel: {panel_id}")

    def _panel_view(self, panel_id: str) -> dict[str, Any]:
        return self._spec["view"] if panel_id == "main" else self._panel_spec(panel_id)["view"]

    def _views(self) -> dict[str, dict[str, Any]]:
        views = {"main": copy.deepcopy(self._spec["view"])}
        views.update({panel["id"]: copy.deepcopy(panel["view"]) for panel in self._spec.get("panels", []) if panel["id"] != "main"})
        return views

    def _commit_views(self, views: dict[str, dict[str, Any]]) -> None:
        """Validate every panel before replacing any view."""
        validated = {panel_id: _view(view, self._panel_view(panel_id)["kind"]) for panel_id, view in views.items()}
        self._validate_axis_contract(self._spec["layers"], self._spec.get("categories", {}), validated)
        for panel_id, view in validated.items():
            if panel_id == "main":
                self._spec["view"] = view
            else:
                self._panel_spec(panel_id)["view"] = view

    def _share_view(self, views: dict[str, dict[str, Any]], source_id: str) -> None:
        layout = self._spec.get("layout", {})
        for axis in "xy":
            if layout.get(f"share{axis.upper()}"):
                source = views[source_id]
                for view in views.values():
                    view[f"{axis}Scale"] = source[f"{axis}Scale"]
                    if f"{axis}Domain" in source:
                        view[f"{axis}Domain"] = copy.deepcopy(source[f"{axis}Domain"])
                    else:
                        view.pop(f"{axis}Domain", None)

    def panel(self, row: int, col: int) -> Panel:
        with self._lock:
            self._ensure_open()
            layout = self._spec.get("layout", {"rows": 1, "cols": 1})
            if any(isinstance(value, bool) or not isinstance(value, int) for value in (row, col)):
                raise TypeError("Panel row and col must be integers")
            if not (0 <= row < layout["rows"] and 0 <= col < layout["cols"]):
                raise IndexError("Panel position is outside the subplot grid")
            return Panel(self, "main" if row == col == 0 else f"panel-{row}-{col}")

    def _add_annotation(self, kind: str, values: dict[str, Any], panel_id: str = "main") -> Annotation:
        validated = _annotation(kind, values)
        with self._lock:
            self._ensure_open()
            if self._panel_view(panel_id)["kind"] != "2d":
                raise ValueError("Annotations support 2D figures only")
            annotation = {"id": _id("annotation"), "kind": kind, **validated}
            if panel_id != "main":
                annotation["panelId"] = panel_id
            self._spec["protocolVersion"] = max(self._spec["protocolVersion"], EXTENDED_PROTOCOL_VERSION)
            self._spec.setdefault("annotations", []).append(annotation)
        self._publish()
        return Annotation(self, annotation["id"])

    def text(self, x: float, y: float, text: str, **style: Any) -> Annotation:
        return self._add_annotation("text", {**style, "x": x, "y": y, "text": text})

    def axhline(self, y: float, **style: Any) -> Annotation:
        return self._add_annotation("hline", {**style, "y": y})

    def axvline(self, x: float, **style: Any) -> Annotation:
        return self._add_annotation("vline", {**style, "x": x})

    @staticmethod
    def _descriptor(data_id: str, array: NumericData, version: int) -> dict[str, Any]:
        return {"id": data_id, "dtype": array.dtype.name, "shape": list(array.shape), "version": version, "byteLength": array.nbytes}

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {"figure": copy.deepcopy(self._spec), "sources": [copy.deepcopy(v[0]) for v in self._sources.values()]}

    def _data_bytes(self, data_id: str, version: int) -> bytes:
        with self._lock:
            descriptor, array = self._sources[data_id]
            if version != descriptor["version"]:
                raise ValueError("Stale data version; fetch a fresh snapshot")
            return array.tobytes(order="C")

    def _publish(self) -> None:
        for listener in tuple(self._listeners):
            listener()

    def _category_key(self, panel_id: str, axis: str) -> str:
        shared = self._spec.get("layout", {}).get("share" + axis.upper(), False)
        return f"{axis}:{'shared' if shared else panel_id}"

    def _layer_arrays(self, layer: dict[str, Any]) -> dict[str, NumericData]:
        return {name: self._sources[source][1] for name, source in layer["data"].items()}

    def _coordinate(self, value: Any, axis: str, panel_id: str, categories: dict[str, list[str]], categorical: dict[str, bool]) -> NumericData:
        key = self._category_key(panel_id, axis)
        # Numeric buffer exporters bypass string adaptation and retain their dtype.
        if isinstance(value, NumericData):
            entries = None
        else:
            try:
                view = memoryview(value)
            except (ValueError, BufferError) as exc:
                raise TypeError(f"{axis} must contain real numeric values; unsupported buffer format") from exc
            except TypeError:
                if isinstance(value, (str, bytes, dict)):
                    raise TypeError("Coordinates must be 1D numeric or string arrays")
                try:
                    entries = list(value)
                except TypeError:
                    return _statistics.vector(value, axis)
            else:
                view.release()
                entries = None
        is_category = entries is not None and (any(isinstance(item, str) for item in entries) or (not entries and key in categories))
        if is_category:
            if not all(isinstance(item, str) for item in entries):
                raise TypeError("Categorical coordinates must contain only strings")
            labels = categories.setdefault(key, [])
            lookup = {label: index for index, label in enumerate(labels)}
            indices = []
            for item in entries:
                if item not in lookup:
                    lookup[item] = len(labels)
                    labels.append(item)
                indices.append(lookup[item])
            categorical[axis] = True
            return _array(indices, axis)
        categorical.pop(axis, None)
        return _statistics.vector(value if entries is None else entries, axis)

    def _validate_axis_contract(self, layers: list[dict[str, Any]], categories: dict[str, list[str]], views: dict[str, dict[str, Any]] | None = None) -> None:
        views = self._views() if views is None else views
        modes: dict[str, bool] = {}
        for layer in layers:
            panel_id = layer.get("panelId", "main")
            view = views[panel_id]
            if layer["kind"] in ("hist", "bar", "boxplot"):
                if view["kind"] != "2d" or view["xScale"] != "linear" or view["yScale"] != "linear":
                    raise ValueError("Statistical layers require linear 2D axes")
            for axis in "xy":
                key = self._category_key(panel_id, axis)
                categorical = layer.get("categorical", {}).get(axis, False)
                if key in modes and modes[key] != categorical:
                    raise ValueError("Cannot mix numeric and categorical data on an axis")
                modes[key] = categorical
                if key in categories and not categorical:
                    raise ValueError("Cannot mix numeric and categorical data on an axis")
                if categorical and (view["kind"] != "2d" or view[axis + "Scale"] != "linear"):
                    raise ValueError("Categorical axes require a linear 2D view")
        for panel_id, view in views.items():
            for axis in "xy":
                if self._category_key(panel_id, axis) in categories and (view["kind"] != "2d" or view[axis + "Scale"] != "linear"):
                    raise ValueError("Categorical axes require a linear 2D view")

    def _validate_bars(self, layers: list[dict[str, Any]], overrides: dict[str, dict[str, NumericData]] | None = None, modes: dict[str, str] | None = None) -> None:
        modes = self._spec.get("barModes", {}) if modes is None else modes
        panels: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for layer in layers:
            if layer["kind"] == "bar":
                panels[layer.get("panelId", "main")].append(layer)
        for panel_id, bars in panels.items():
            mode = modes.get(panel_id, "group")
            if len({bar["options"]["orientation"] for bar in bars}) > 1:
                raise ValueError("Bars in one panel must have the same orientation")
            if mode in ("group", "stack") and len({bar["options"]["barWidth"] for bar in bars}) > 1:
                raise ValueError("Grouped and stacked bars must have matching bar widths")
            if mode == "stack":
                for bar in bars:
                    arrays = (overrides or {}).get(bar["id"])
                    if arrays is None:
                        arrays = self._layer_arrays(bar)
                    if any(value != 0 for value in arrays["base"]):
                        raise ValueError("Stacked bars require zero baselines")

    def _validate_layer_candidate(self, layer: dict[str, Any], arrays: dict[str, NumericData], categories: dict[str, list[str]]) -> None:
        if layer["kind"] == "bar":
            value_axis = "y" if layer["options"]["orientation"] == "vertical" else "x"
            positions = list(arrays["x" if value_axis == "y" else "y"])
            if any(not math.isfinite(value) for value in positions) or len(set(positions)) != len(positions):
                raise ValueError("Bar positions must be finite and unique")
            if any(math.isfinite(value) and not math.isfinite(base + value) for base, value in zip(arrays["base"], arrays[value_axis])):
                raise ValueError("Bar baseline plus value must remain finite")
        layers = [item for item in self._spec["layers"] if item["id"] != layer["id"]] + [layer]
        self._validate_axis_contract(layers, categories)
        self._validate_bars(layers, {layer["id"]: arrays})

    def _commit_layer_arrays(self, layer: dict[str, Any], arrays: dict[str, NumericData], changed: set[str], categories: dict[str, list[str]]) -> None:
        for name in set(layer["data"]) - arrays.keys():
            self._sources.pop(layer["data"].pop(name), None)
        for name in arrays:
            if name not in changed:
                continue
            data_id = layer["data"].get(name, _id("data"))
            previous = self._sources.get(data_id)
            version = previous[0]["version"] + 1 if previous else 1
            layer["data"][name] = data_id
            self._sources[data_id] = (self._descriptor(data_id, arrays[name], version), arrays[name])
        if categories:
            self._spec["categories"] = categories
        if categories or layer["kind"] in ("hist", "bar", "boxplot"):
            self._spec["protocolVersion"] = max(self._spec["protocolVersion"], STATISTICS_PROTOCOL_VERSION)

    def _set_categories(self, panel_id: str, axis: str, labels: Any) -> None:
        if axis not in ("x", "y"):
            raise ValueError("Categorical axis must be 'x' or 'y'")
        if isinstance(labels, (str, bytes, dict)):
            raise TypeError("categories must be a sequence of unique strings")
        labels = list(labels)
        if any(not isinstance(label, str) for label in labels) or len(set(labels)) != len(labels):
            raise ValueError("categories must be a sequence of unique strings")
        with self._lock:
            self._ensure_open()
            self._panel_view(panel_id)
            key = self._category_key(panel_id, axis)
            if any(self._category_key(layer.get("panelId", "main"), axis) == key for layer in self._spec["layers"]):
                raise ValueError("Set categories before adding data to the axis")
            categories = copy.deepcopy(self._spec.get("categories", {}))
            previous = categories.get(key, [])
            if labels[:len(previous)] != previous:
                raise ValueError("Category order is append-only")
            categories[key] = labels
            self._validate_axis_contract(self._spec["layers"], categories)
            self._spec["categories"] = categories
            self._spec["protocolVersion"] = max(self._spec["protocolVersion"], STATISTICS_PROTOCOL_VERSION)
        self._publish()

    def set_categories(self, axis: str, labels: Any) -> Figure:
        self._set_categories("main", axis, labels)
        return self

    def _set_bar_mode(self, panel_id: str, mode: str) -> None:
        if mode not in ("group", "stack", "overlay"):
            raise ValueError("Bar mode must be 'group', 'stack', or 'overlay'")
        with self._lock:
            self._ensure_open()
            if self._panel_view(panel_id)["kind"] != "2d":
                raise ValueError("Bar modes require a 2D panel")
            modes = {**self._spec.get("barModes", {}), panel_id: mode}
            self._validate_bars(self._spec["layers"], modes=modes)
            self._spec["barModes"] = modes
            self._spec["protocolVersion"] = max(self._spec["protocolVersion"], STATISTICS_PROTOCOL_VERSION)
        self._publish()

    def set_bar_mode(self, mode: str) -> Figure:
        self._set_bar_mode("main", mode)
        return self

    def _add_statistics(self, kind: str, args: tuple[Any, ...], options: dict[str, Any], panel_id: str = "main") -> Layer:
        options = dict(options)
        option_keys = {"hist": {"bins", "range", "density", "cumulative"},
                       "bar": {"orientation", "barWidth", "bar_width"},
                       "boxplot": {"orientation", "whis", "showfliers", "boxWidth", "box_width"}}[kind]
        settings = _statistics.options(kind, {name: options.pop(name) for name in option_keys if name in options})
        labels = options.pop("labels", None) if kind == "boxplot" else None
        base_name = "bottom" if settings.get("orientation") == "vertical" else "left"
        base = options.pop(base_name, 0) if kind == "bar" else None
        style = _style(options)
        with self._lock:
            self._ensure_open()
            self._panel_view(panel_id)
            categories = copy.deepcopy(self._spec.get("categories", {}))
            categorical: dict[str, bool] = {}
            if kind == "hist":
                arrays = {"samples": _statistics.vector(args[0], "samples")}
            elif kind == "bar":
                axis = "x" if settings["orientation"] == "vertical" else "y"
                position = self._coordinate(args[0], axis, panel_id, categories, categorical)
                values = _statistics.vector(args[1], "values")
                if position.size != values.size:
                    raise ValueError("Bar coordinates and values must have matching lengths")
                arrays = {axis: position, "y" if axis == "x" else "x": values, "base": _statistics.baseline(base, values.size)}
            else:
                groups = _statistics.groups(args[0])
                names = _statistics.labels(labels, len(groups))
                axis = "x" if settings["orientation"] == "vertical" else "y"
                categories.setdefault(self._category_key(panel_id, axis), [])
                position = self._coordinate(names, axis, panel_id, categories, categorical)
                arrays = {axis: position, **{f"g{i}": group for i, group in enumerate(groups)}}
            layer: dict[str, Any] = {"id": _id("layer"), "kind": kind, "data": {}, "style": style, "visible": True, "options": settings}
            if panel_id != "main":
                layer["panelId"] = panel_id
            if categorical:
                layer["categorical"] = categorical
            self._validate_layer_candidate(layer, arrays, categories)
            self._commit_layer_arrays(layer, arrays, set(arrays), categories)
            self._spec["layers"].append(layer)
        self._publish()
        return Layer(self, layer["id"])

    def hist(self, samples: Any, **options: Any) -> Layer:
        return self._add_statistics("hist", (samples,), options)

    def bar(self, x: Any, values: Any, **options: Any) -> Layer:
        return self._add_statistics("bar", (x, values), {**options, "orientation": "vertical"})

    def barh(self, y: Any, values: Any, **options: Any) -> Layer:
        return self._add_statistics("bar", (y, values), {**options, "orientation": "horizontal"})

    def boxplot(self, groups: Any, **options: Any) -> Layer:
        return self._add_statistics("boxplot", (groups,), options)

    def _add(self, kind: str, args: tuple[Any, ...], options: dict[str, Any], *, panel_id: str = "main") -> Layer:
        options = dict(options)
        data_options = {name: options.pop(name) for name in ("x", "y", "values") if name in options}
        if "color" in options and not isinstance(options["color"], str):
            data_options["color"] = options.pop("color")
        style = _style(options)
        dimension = "3d" if kind in ("surface", "scatter3d") else "2d"
        with self._lock:
            self._ensure_open()
            self._panel_view(panel_id)
            if dimension == "3d" and (self._spec.get("layout") or self._spec.get("annotations") or self._spec.get("barModes")):
                raise ValueError("Subplots, annotations and bar modes support 2D figures only")
            if (self._spec["layers"] or self._spec.get("bookmarks")) and self._spec["view"]["kind"] != dimension:
                raise ValueError("2D and 3D layers or bookmarks require separate figures")
            categories = copy.deepcopy(self._spec.get("categories", {}))
            categorical: dict[str, bool] = {}
            if kind in ("line", "scatter"):
                if len(args) == 1:
                    y = self._coordinate(args[0], "y", panel_id, categories, categorical)
                    args = (numeric_range(y.size), y)
                elif len(args) == 2:
                    args = tuple(self._coordinate(value, axis, panel_id, categories, categorical) for axis, value in zip("xy", args))
            arrays = _prepare(kind, *args, **data_options)
            layer_id = _id("layer")
            layer: dict[str, Any] = {"id": layer_id, "kind": kind, "data": {}, "style": style, "visible": True}
            if panel_id != "main":
                layer["panelId"] = panel_id
            if categorical:
                layer["categorical"] = categorical
            self._validate_layer_candidate(layer, arrays, categories)
            self._spec["view"]["kind"] = dimension
            self._commit_layer_arrays(layer, arrays, set(arrays), categories)
            self._spec["layers"].append(layer)
        self._publish()
        return Layer(self, layer_id)

    def _update_layer_data(self, layer: dict[str, Any], args: tuple[Any, ...], values: dict[str, Any]) -> None:
        with self._lock:
            self._ensure_open()
            if not any(item is layer for item in self._spec["layers"]):
                raise RuntimeError("Layer has been removed")
            kind, panel_id = layer["kind"], layer.get("panelId", "main")
            current = self._layer_arrays(layer)
            incoming = dict(values)
            categories = copy.deepcopy(self._spec.get("categories", {}))
            categorical = dict(layer.get("categorical", {}))
            if kind in ("line", "scatter"):
                if "values" in incoming:
                    if "color" in incoming:
                        raise TypeError("Supply only one of values and color")
                    incoming["color"] = incoming.pop("values")
                if args:
                    if len(args) not in (1, 2) or incoming.keys() - {"color"}:
                        raise TypeError(f"{kind} expects y or x, y with optional color values")
                    if len(args) == 1:
                        y = self._coordinate(args[0], "y", panel_id, categories, categorical)
                        incoming.update(x=numeric_range(y.size), y=y)
                        categorical.pop("x", None)
                    else:
                        incoming.update(zip("xy", args))
                if incoming.keys() - {"x", "y", "color"}:
                    raise TypeError("Unknown data channels")
                arrays = dict(current)
                for axis in "xy":
                    if axis in incoming:
                        # The y-only positional path was already encoded above.
                        arrays[axis] = incoming[axis] if args and len(args) == 1 else self._coordinate(incoming[axis], axis, panel_id, categories, categorical)
                if "color" in incoming:
                    arrays["color"] = _statistics.vector(incoming["color"], "color")
                elif args and "color" in arrays and arrays["color"].shape != arrays["x"].shape:
                    raise ValueError("Update scalar colors when changing the point count")
                arrays = _prepare(kind, arrays["x"], arrays["y"], color=arrays.get("color"))
                changed = set(incoming)
            elif kind == "hist":
                if args:
                    if len(args) != 1 or incoming:
                        raise TypeError("hist set_data expects samples")
                    incoming["samples"] = args[0]
                if incoming.keys() - {"samples"}:
                    raise TypeError("Histogram data only accepts samples")
                arrays = dict(current)
                if "samples" in incoming:
                    arrays["samples"] = _statistics.vector(incoming["samples"], "samples")
                changed = set(incoming)
            elif kind == "bar":
                axis = "x" if layer["options"]["orientation"] == "vertical" else "y"
                value_axis = "y" if axis == "x" else "x"
                if args:
                    if len(args) != 2 or incoming.keys() - {"base", "bottom", "left"}:
                        raise TypeError("bar set_data expects positions and values")
                    incoming.update({axis: args[0], value_axis: args[1]})
                for alias in ("bottom", "left"):
                    if alias in incoming:
                        if alias != ("bottom" if axis == "x" else "left"):
                            raise TypeError("Use bottom for vertical bars and left for horizontal bars")
                        if "base" in incoming:
                            raise TypeError("Supply only one baseline argument")
                        incoming["base"] = incoming.pop(alias)
                if incoming.keys() - {"x", "y", "base"}:
                    raise TypeError("Bar data accepts x, y, base, bottom or left")
                arrays = dict(current)
                if axis in incoming:
                    arrays[axis] = self._coordinate(incoming[axis], axis, panel_id, categories, categorical)
                if value_axis in incoming:
                    arrays[value_axis] = _statistics.vector(incoming[value_axis], value_axis)
                if arrays[axis].size != arrays[value_axis].size:
                    raise ValueError("Bar coordinates and values must have matching lengths")
                arrays["base"] = _statistics.baseline(incoming.get("base", arrays["base"]), arrays[axis].size)
                changed = set(incoming)
            else:
                if args:
                    if len(args) != 1 or "groups" in incoming:
                        raise TypeError("boxplot set_data expects groups")
                    incoming["groups"] = args[0]
                if incoming.keys() - {"groups", "labels"}:
                    raise TypeError("Boxplot data only accepts groups and labels")
                axis = "x" if layer["options"]["orientation"] == "vertical" else "y"
                old_count = current[axis].size
                groups = _statistics.groups(incoming["groups"]) if "groups" in incoming else [current[f"g{i}"] for i in range(old_count)]
                arrays = {axis: current[axis], **{f"g{i}": group for i, group in enumerate(groups)}}
                changed = {f"g{i}" for i in range(len(groups))} if "groups" in incoming else set()
                if "labels" in incoming or len(groups) != old_count:
                    names = _statistics.labels(incoming.get("labels"), len(groups))
                    arrays[axis] = self._coordinate(names, axis, panel_id, categories, categorical)
                    changed.add(axis)
            candidate = {**layer}
            if categorical:
                candidate["categorical"] = categorical
            else:
                candidate.pop("categorical", None)
            self._validate_layer_candidate(candidate, arrays, categories)
            if categorical:
                layer["categorical"] = categorical
            else:
                layer.pop("categorical", None)
            self._commit_layer_arrays(layer, arrays, changed, categories)
        self._publish()

    def plot(self, *args: Any, **style: Any) -> Layer:
        return self._add("line", args, style)

    def scatter(self, x: Any, y: Any, **style: Any) -> Layer:
        return self._add("scatter", (x, y), style)

    def scatter3d(self, x: Any, y: Any, z: Any, **style: Any) -> Layer:
        return self._add("scatter3d", (x, y, z), style)

    def heatmap(self, *args: Any, **style: Any) -> Layer:
        return self._add("heatmap", args, style)

    def surface(self, *args: Any, **style: Any) -> Layer:
        return self._add("surface", args, style)

    def set_axes(self, **options: Any) -> Figure:
        self._set_panel_axes("main", options)
        return self

    def _set_panel_axes(self, panel_id: str, options: dict[str, Any]) -> None:
        aliases = {f"{a}{s}": f"{a}{v}" for a in "xyz" for s, v in (("scale", "Scale"), ("lim", "Domain"), ("label", "Label"))}
        unknown = options.keys() - aliases.keys()
        if unknown:
            raise TypeError(f"Unknown axis option(s): {', '.join(sorted(unknown))}")
        with self._lock:
            self._ensure_open()
            views = self._views()
            view = views[panel_id]
            for key, value in options.items():
                if key.endswith("scale") and value not in ("linear", "log"):
                    raise ValueError("Scale must be 'linear' or 'log'")
                view[aliases[key]] = value
            for axis in "xyz":
                domain_key = f"{axis}Domain"
                if domain_key in view:
                    if view[domain_key] is None:
                        del view[domain_key]
                    else:
                        view[domain_key] = _domain(view[domain_key], domain_key, view[f"{axis}Scale"])
                view[f"{axis}Label"] = str(view[f"{axis}Label"])
            self._share_view(views, panel_id)
            self._commit_views(views)
        self._publish()

    def set_title(self, title: str) -> Figure:
        with self._lock:
            self._ensure_open()
            self._spec["title"] = str(title)
        self._publish()
        return self

    def bookmark(self, name: str, *, note: str = "") -> Figure:
        """Remember the current view; replacing a name preserves its position."""
        name = _bookmark_name(name)
        if not isinstance(note, str):
            raise TypeError("Bookmark note must be a string")
        with self._lock:
            self._ensure_open()
            entry = {"name": name, "view": _view(self._spec["view"], self._spec["view"]["kind"])}
            if "layout" in self._spec:
                entry["panelViews"] = {panel_id: _view(view, "2d") for panel_id, view in self._views().items() if panel_id != "main"}
            if note:
                entry["note"] = note
            bookmarks = self._spec.setdefault("bookmarks", [])
            for index, item in enumerate(bookmarks):
                if item["name"] == name:
                    bookmarks[index] = entry
                    break
            else:
                bookmarks.append(entry)
        self._publish()
        return self

    def restore_bookmark(self, name: str) -> Figure:
        """Restore a complete view without changing layer data or visibility."""
        name = _bookmark_name(name)
        with self._lock:
            self._ensure_open()
            entry = next((item for item in self._spec.get("bookmarks", []) if item["name"] == name), None)
            if entry is None:
                raise ValueError(f"Unknown bookmark: {name}")
            views = self._views()
            views["main"] = copy.deepcopy(entry["view"])
            views.update(copy.deepcopy(entry.get("panelViews", {})))
            self._commit_views(views)
        self._publish()
        return self

    def remove_bookmark(self, name: str) -> Figure:
        name = _bookmark_name(name)
        with self._lock:
            self._ensure_open()
            bookmarks = self._spec.get("bookmarks", [])
            entry = next((item for item in bookmarks if item["name"] == name), None)
            if entry is None:
                raise ValueError(f"Unknown bookmark: {name}")
            bookmarks.remove(entry)
            if not bookmarks:
                self._spec.pop("bookmarks", None)
        self._publish()
        return self

    def to_html(self) -> str:
        """Return a standalone interactive HTML document, without starting a host."""
        from .html import make_html
        with self._lock:
            self._ensure_open()
            snapshot = self.snapshot()
            buffers = [(source["id"], self._data_bytes(source["id"], source["version"])) for source in snapshot["sources"]]
        return make_html(snapshot, buffers)

    def save_html(self, path: str | Path) -> Path:
        """Write a standalone interactive HTML document to disk."""
        path = Path(path)
        if path.suffix.lower() not in (".html", ".htm"):
            raise ValueError("HTML export requires a .html or .htm path")
        path.write_text(self.to_html(), encoding="utf-8")
        return path

    def on(self, event: str, callback: Callable[[Any], None]) -> Callable[[], None]:
        self._events[event].append(callback)
        def unsubscribe() -> None:
            if callback in self._events[event]:
                self._events[event].remove(callback)
        return unsubscribe

    def _emit(self, event: str, payload: Any) -> None:
        import warnings
        if event == "viewchange":
            self._accept_view(payload)
        for callback in tuple(self._events.get(event, ())):
            try:
                callback(payload)
            except Exception as exc:
                warnings.warn(f"Vesora {event} callback failed: {exc}", RuntimeWarning, stacklevel=2)

    def _accept_view(self, payload: Any) -> None:
        """Retain browser interaction state without echoing another update to it."""
        if not isinstance(payload, dict):
            raise ValueError("viewchange payload must be an object")
        allowed = {"kind", "camera", "pan3d"} | {f"{axis}{field}" for axis in "xyz" for field in ("Scale", "Domain", "Label")}
        with self._lock:
            views = self._views()
            source_id = payload.get("panelId", "main")
            if source_id not in views:
                raise ValueError(f"Unknown panel: {source_id}")
            views["main"].update({key: value for key, value in payload.items() if key in allowed})
            panel_views = payload.get("panelViews", {})
            if not isinstance(panel_views, dict):
                raise ValueError("panelViews must be an object")
            for panel_id, value in panel_views.items():
                if panel_id == "main" or panel_id not in views or not isinstance(value, dict):
                    raise ValueError(f"Invalid panel view: {panel_id}")
                views[panel_id].update({key: item for key, item in value.items() if key in allowed})
            self._share_view(views, source_id)
            self._commit_views(views)

    def show(self, *, block: bool = True, host: str = "auto") -> Any:
        self._ensure_open()
        if host == "auto":
            host = _default_host()
        if host == "notebook":
            from .notebook import make_widget
            if self._widget is None:
                self._widget = make_widget(self)
            from IPython.display import display
            display(self._widget)
            return self._widget
        if host != "desktop":
            raise ValueError("host must be 'auto', 'desktop', or 'notebook'")
        from .qt import show_figure
        return show_figure(self, block=block)

    def savefig(self, path: str | Path, *, timeout: float = 30) -> Path:
        self._ensure_open()
        path = Path(path)
        if path.suffix.lower() != ".png":
            raise ValueError("This release exports PNG; SVG/PDF export is not supported")
        from .qt import save_figure
        return save_figure(self, path, timeout=timeout)

    async def savefig_async(self, path: str | Path, *, timeout: float = 30) -> Path:
        """Export from a displayed notebook widget without blocking its comm messages."""
        self._ensure_open()
        path = Path(path)
        if path.suffix.lower() != ".png":
            raise ValueError("This release exports PNG only")
        if self._widget is None:
            raise RuntimeError("Display this figure in a notebook before savefig_async()")
        payload = await self._widget.export_png(timeout=timeout)
        path.write_bytes(payload)
        return path

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._window is not None:
            self._window.close()
        if self._widget is not None:
            self._widget.close()
        if self._host is not None:
            self._host.close()
        self._listeners.clear()
        self._sources.clear()
        self._emit("close", None)

    def _repr_mimebundle_(self, **kwargs: Any) -> Any:
        from .notebook import make_widget
        if self._widget is None:
            self._widget = make_widget(self)
        return self._widget._repr_mimebundle_(**kwargs)

    def __enter__(self) -> Figure:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()
