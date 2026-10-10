"""Vesora: Python data APIs backed by one shared TypeScript visualization engine."""
from __future__ import annotations
from typing import Any
from .figure import Figure, Layer, Panel, Annotation, PROTOCOL_VERSION, EXTENDED_PROTOCOL_VERSION, STATISTICS_PROTOCOL_VERSION

__version__ = "0.4.0"
__all__ = ["Figure", "Layer", "Panel", "Annotation", "figure", "subplots", "plot", "scatter", "heatmap", "surface", "scatter3d", "hist", "bar", "barh", "boxplot", "show", "savefig", "process_events"]
_last_figure: Figure | None = None


def figure(**options: Any) -> Figure:
    global _last_figure
    _last_figure = Figure(**options)
    return _last_figure


def subplots(rows: int, cols: int, *, sharex: bool = False, sharey: bool = False, **options: Any) -> Figure:
    """Create a 2D panel grid. Use fig.panel(row, col) with zero-based indices."""
    global _last_figure
    result = Figure(**options)
    result._set_layout(rows, cols, sharex=sharex, sharey=sharey)
    _last_figure = result
    return result


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


def hist(*args: Any, **options: Any) -> Layer:
    return _convenience("hist", *args, **options)


def bar(*args: Any, **options: Any) -> Layer:
    return _convenience("bar", *args, **options)


def barh(*args: Any, **options: Any) -> Layer:
    return _convenience("barh", *args, **options)


def boxplot(*args: Any, **options: Any) -> Layer:
    return _convenience("boxplot", *args, **options)


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
