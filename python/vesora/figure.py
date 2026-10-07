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

PROTOCOL_VERSION = 1
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

    def _add(self, kind: str, args: tuple[Any, ...], options: dict[str, Any]) -> Layer:
        data_options = {name: options.pop(name) for name in ("x", "y", "values") if name in options}
        if "color" in options and not isinstance(options["color"], str):
            data_options["color"] = options.pop("color")
        arrays = _prepare(kind, *args, **data_options)
        style = _style(options)
        dimension = "3d" if kind in ("surface", "scatter3d") else "2d"
        with self._lock:
            self._ensure_open()
            if (self._spec["layers"] or self._spec.get("bookmarks")) and self._spec["view"]["kind"] != dimension:
                raise ValueError("2D and 3D layers or bookmarks require separate figures")
            self._spec["view"]["kind"] = dimension
            refs = {}
            for name, array in arrays.items():
                data_id = _id("data")
                refs[name] = data_id
                self._sources[data_id] = (self._descriptor(data_id, array, 1), array)
            layer_id = _id("layer")
            self._spec["layers"].append({"id": layer_id, "kind": kind, "data": refs, "style": style, "visible": True})
        self._publish()
        return Layer(self, layer_id)

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
        aliases = {f"{a}{s}": f"{a}{v}" for a in "xyz" for s, v in (("scale", "Scale"), ("lim", "Domain"), ("label", "Label"))}
        unknown = options.keys() - aliases.keys()
        if unknown:
            raise TypeError(f"Unknown axis option(s): {', '.join(sorted(unknown))}")
        with self._lock:
            self._ensure_open()
            view = copy.deepcopy(self._spec["view"])
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
            self._spec["view"] = view
        self._publish()
        return self

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
            self._spec["view"] = _view(entry["view"], self._spec["view"]["kind"])
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
            view = copy.deepcopy(self._spec["view"])
            view.update({key: value for key, value in payload.items() if key in allowed})
            self._spec["view"] = _view(view, self._spec["view"]["kind"])

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
