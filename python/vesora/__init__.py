"""Vesora: Python data APIs backed by one shared TypeScript visualization engine."""
from __future__ import annotations
from typing import Any
from .figure import Figure, Layer, PROTOCOL_VERSION

__version__ = "0.2.0"
__all__ = ["Figure", "Layer", "figure", "plot", "scatter", "heatmap", "surface", "scatter3d", "show", "savefig", "process_events"]
_last_figure: Figure | None = None


def figure(**options: Any) -> Figure:
    global _last_figure
    _last_figure = Figure(**options)
    return _last_figure


def _convenience(method: str, *args: Any, **options: Any) -> Layer:
    target = _last_figure
    if target is None or target._closed:
        target = figure()
    return getattr(target, method)(*args, **options)


def plot(*args: Any, **options: Any) -> Layer:
    return _convenience("plot", *args, **options)


def scatter(*args: Any, **options: Any) -> Layer:
    return _convenience("scatter", *args, **options)


def heatmap(*args: Any, **options: Any) -> Layer:
    return _convenience("heatmap", *args, **options)


def surface(*args: Any, **options: Any) -> Layer:
    return _convenience("surface", *args, **options)


def scatter3d(*args: Any, **options: Any) -> Layer:
    return _convenience("scatter3d", *args, **options)


def show(fig: Figure | None = None, **options: Any) -> Any:
    target = fig if fig is not None else _last_figure
    if target is None:
        raise RuntimeError("Create a figure before calling show()")
    return target.show(**options)


def savefig(path: Any, *, fig: Figure | None = None, **options: Any) -> Any:
    target = fig if fig is not None else _last_figure
    if target is None:
        raise RuntimeError("Create a figure before calling savefig()")
    return target.savefig(path, **options)


def process_events() -> None:
    """Process GUI events when a script uses show(block=False)."""
    from .qt import process_events as process
    process()
