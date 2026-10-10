import json
import math
import struct
from array import array

import pytest

import vesora as vs


def test_current_figure_layers_and_explicit_isolation():
    fig = vs.figure(title="Experiment")
    first = vs.plot([1., 2., 3.])
    second = vs.scatter([0., 1.], [2., 4.])
    assert first.figure is fig and second.figure is fig
    assert [layer["kind"] for layer in fig.snapshot()["figure"]["layers"]] == ["line", "scatter"]
    other = vs.figure()
    assert vs.plot([0.]).figure is other
    assert len(fig.snapshot()["figure"]["layers"]) == 2
    fig.close()
    other.close()


_WIRE_FORMATS = {"float64": "d", "float32": "f", "int32": "i", "uint32": "I",
                 "int16": "h", "uint16": "H", "int8": "b", "uint8": "B"}


def source_data(fig, channel, layer_index=0):
    """Read the public protocol descriptor and its canonical little-endian payload."""
    snapshot = fig.snapshot()
    source_id = snapshot["figure"]["layers"][layer_index]["data"][channel]
    descriptor = next(source for source in snapshot["sources"] if source["id"] == source_id)
    payload = fig._data_bytes(source_id, descriptor["version"])
    code = _WIRE_FORMATS[descriptor["dtype"]]
    assert len(payload) == descriptor["byteLength"]
    assert len(payload) == math.prod(descriptor["shape"]) * struct.calcsize(code)
    values = list(struct.unpack("<" + code * math.prod(descriptor["shape"]), payload))
    return descriptor, payload, values


@pytest.mark.parametrize("factory", [list, tuple, lambda items: range(1, 4), lambda items: (v for v in items)])
def test_builtin_sequences_are_float64_and_implicit_x_is_normalized(factory):
    fig = vs.Figure()
    fig.plot(factory([1, 2, 3]))
    x, _, xs = source_data(fig, "x")
    y, payload, ys = source_data(fig, "y")
    assert x["dtype"] == y["dtype"] == "float64"
    assert x["shape"] == y["shape"] == [3]
    assert xs == [0, 1, 2] and ys == [1, 2, 3]
    assert payload == struct.pack("<3d", 1, 2, 3)


def test_builtin_ownership_boolean_empty_and_nonfinite_values():
    values = [1., 2., 3.]
    fig = vs.Figure()
    fig.scatter(values, values)
    values[:] = [9.]
    assert source_data(fig, "x")[2] == [1, 2, 3]
    assert source_data(fig, "y")[2] == [1, 2, 3]
    empty = vs.Figure()
    empty.plot([])
    assert source_data(empty, "y") == (empty.snapshot()["sources"][1], b"", [])
    assert source_data(empty, "y")[0]["dtype"] == "float64"
    bools = vs.Figure()
    bools.plot([True, False, True])
    assert source_data(bools, "y")[0]["dtype"] == "uint8"
    assert source_data(bools, "y")[1] == b"\x01\x00\x01"
    nonfinite = vs.Figure()
    nonfinite.plot([math.nan, math.inf, -math.inf])
    result = source_data(nonfinite, "y")[2]
    assert math.isnan(result[0]) and result[1:] == [math.inf, -math.inf]
    json.dumps(nonfinite.snapshot(), allow_nan=False)


@pytest.mark.parametrize("code,dtype", [("b", "int8"), ("B", "uint8"), ("h", "int16"), ("H", "uint16"),
                                      ("i", "int32"), ("I", "uint32"), ("f", "float32"), ("d", "float64")])
@pytest.mark.parametrize("wrap", [lambda value: value, memoryview], ids=["array", "memoryview"])
def test_standard_buffers_preserve_dtype_endianness_and_ownership(code, dtype, wrap):
    original = array(code, [1, 2, 3])
    fig = vs.Figure()
    fig.plot(wrap(original))
    source, payload, values = source_data(fig, "y")
    assert source["dtype"] == dtype and source["shape"] == [3]
    assert payload == struct.pack("<3" + _WIRE_FORMATS[dtype], 1, 2, 3)
    original[0] = 7
    assert source_data(fig, "y")[1] == payload
    assert values == [1, 2, 3]


@pytest.mark.parametrize("stride,expected", [(2, [0, 2, 4, 6, 8]), (-2, [9, 7, 5, 3, 1])])
def test_strided_memoryview_is_copied_in_logical_order(stride, expected):
    original = array("d", range(10))
    fig = vs.Figure()
    fig.plot(memoryview(original)[::stride])
    source, payload, values = source_data(fig, "y")
    assert source["dtype"] == "float64" and source["shape"] == [5]
    assert payload == struct.pack("<5d", *expected)
    original[0] = 99
    assert values == expected and source_data(fig, "y")[1] == payload


def test_multidimensional_memoryview_and_nested_grid_have_row_major_shape():
    values = array("f", [1, 2, 3, 4, 5, 6])
    view = memoryview(values).cast("B").cast("f", shape=[2, 3])
    fig = vs.Figure()
    fig.heatmap(view)
    descriptor, payload, result = source_data(fig, "z")
    assert descriptor["dtype"] == "float32" and descriptor["shape"] == [2, 3]
    assert payload == struct.pack("<6f", 1, 2, 3, 4, 5, 6)
    assert result == [1, 2, 3, 4, 5, 6]
    assert source_data(fig, "x")[2] == [0, 1, 2] and source_data(fig, "y")[2] == [0, 1]
    values[0] = 99
    assert source_data(fig, "z")[1] == payload
    nested = [[1., 2.], [3., 4.]]
    other = vs.Figure()
    other.surface(nested)
    nested[0][0] = 99
    assert source_data(other, "z")[0]["shape"] == [2, 2]
    assert source_data(other, "z")[2] == [1, 2, 3, 4]


@pytest.mark.parametrize("factory", [list, lambda values: array("q", values), lambda values: memoryview(array("q", values))])
def test_signed_integer_boundaries_keep_exact_float64_values(factory):
    fig = vs.Figure()
    fig.plot(factory([-(2**53), 0, 2**53]))
    assert source_data(fig, "y")[2] == [-(2**53), 0, 2**53]
    for invalid in [-(2**53) - 1, 2**53 + 1]:
        with pytest.raises(ValueError, match="exact Float64"):
            fig.plot(factory([invalid]))


def test_unsigned_64_bit_boundary_and_native_long_width():
    fig = vs.Figure()
    fig.plot(array("Q", [0, 2**53]))
    assert source_data(fig, "y")[0]["dtype"] == "float64"
    assert source_data(fig, "y")[2] == [0, 2**53]
    with pytest.raises(ValueError, match="exact Float64"):
        fig.plot(memoryview(array("Q", [2**64 - 1])))
    other = vs.Figure()
    native = array("l", [1, 2, 3])
    other.plot(native)
    assert source_data(other, "y")[0]["dtype"] == ("float64" if native.itemsize == 8 else "int32")


@pytest.mark.parametrize("bad", [[1 + 2j], [object()], [None]])
def test_nonreal_data_is_rejected_without_publishing_a_layer(bad):
    fig = vs.Figure()
    before = fig.snapshot()
    with pytest.raises(TypeError, match="real numeric"):
        fig.plot(bad)
    assert fig.snapshot() == before


@pytest.mark.parametrize("bad", [[[1], [2, 3]], [[1, 2], 3]])
def test_ragged_nested_grids_are_rejected(bad):
    fig = vs.Figure()
    with pytest.raises((TypeError, ValueError)):
        fig.heatmap(bad)
    assert fig.snapshot()["sources"] == []


def test_coordinate_and_grid_dimensions_are_checked_before_publication():
    fig = vs.Figure()
    for x, y in [([[1], [2]], [1, 2]), ([1, 2], [[1], [2]]), (1., 2.)]:
        with pytest.raises(ValueError, match="1D"):
            fig.scatter(x, y)
    with pytest.raises(ValueError, match="2D"):
        fig.heatmap([1, 2, 3])
    with pytest.raises(ValueError, match="Grid requires"):
        fig.heatmap([0, 1], [0, 1], [[1, 2, 3], [4, 5, 6]])
    with pytest.raises(ValueError, match="2D"):
        fig.heatmap([[[1.]]])
    assert fig.snapshot()["sources"] == []


def test_partial_update_is_atomic_and_preserves_color():
    fig = vs.Figure()
    layer = fig.scatter([1., 2.], [3., 4.], color=[0., 1.])
    before = fig.snapshot()
    y_id = before["figure"]["layers"][0]["data"]["y"]
    layer.set_data(y=[5., 6.])
    after = fig.snapshot()
    versions = {source["id"]: source["version"] for source in after["sources"]}
    assert versions[y_id] == 2
    assert sum(version > 1 for version in versions.values()) == 1
    with pytest.raises(ValueError, match="matching lengths"):
        layer.set_data(y=[5.])
    assert fig.snapshot() == after
    with pytest.raises(ValueError, match="Update scalar colors"):
        layer.set_data([1.], [2.])
    assert fig.snapshot() == after
    with pytest.raises(ValueError, match="Stale"):
        fig._data_bytes(y_id, 1)
    layer.set_style(size=4, color_domain=(0, 1))
    assert fig.snapshot()["figure"]["layers"][0]["style"]["colorDomain"] == [0, 1]
    layer.remove()
    assert fig.snapshot()["sources"] == []
    with pytest.raises(RuntimeError, match="removed"):
        layer.set_style(size=2)


def test_grids_dimensions_and_nonfinite_values():
    fig = vs.Figure()
    fig.heatmap([[math.nan]])
    assert fig.snapshot()["sources"][2]["shape"] == [1, 1]
    with pytest.raises(ValueError, match="separate figures"):
        fig.scatter3d([1], [2], [3])
    surface = vs.Figure()
    surface.surface([0, 1], [0, 1], [[1, math.nan], [3, 4]])
    assert surface.snapshot()["figure"]["view"]["kind"] == "3d"
    with pytest.raises(ValueError, match="strictly increasing"):
        surface.surface([0, 0], [0, 1], [[1, 2], [3, 4]])
    with pytest.raises(ValueError, match="2 coordinate"):
        vs.Figure().surface([[1]])
    with pytest.raises(ValueError, match="separate scalar colors"):
        vs.Figure().heatmap([[1]], color=[[1]])


@pytest.mark.parametrize("axis", ["x", "y"])
@pytest.mark.parametrize("coordinates", [[1, 1], [2, 1], [0, math.nan], [0, math.inf], array("H", [65535, 0])])
def test_grid_axes_are_finite_and_strictly_monotonic(axis, coordinates):
    fig = vs.Figure()
    x, y = (coordinates, [0, 1]) if axis == "x" else ([0, 1], coordinates)
    with pytest.raises(ValueError, match="finite and strictly increasing"):
        fig.heatmap(x, y, [[1, 2], [3, 4]])
    assert fig.snapshot()["sources"] == []


def test_partial_updates_preserve_other_payloads_and_change_channel_dtype_atomically():
    fig = vs.Figure()
    layer = fig.scatter(array("d", [1, 2]), array("d", [3, 4]), values=array("B", [0, 1]))
    x_before, x_bytes, _ = source_data(fig, "x")
    color_before, color_bytes, _ = source_data(fig, "color")
    y_before = source_data(fig, "y")[0]
    replacement = array("f", [5, 6])
    layer.set_data(y=memoryview(replacement))
    replacement[0] = 99
    y_after, _, values = source_data(fig, "y")
    assert y_after["id"] == y_before["id"] and y_after["version"] == y_before["version"] + 1
    assert y_after["dtype"] == "float32" and values == [5, 6]
    assert source_data(fig, "x")[:2] == (x_before, x_bytes)
    assert source_data(fig, "color")[:2] == (color_before, color_bytes)
    layer.set_data(values=array("h", [10, 20]))
    assert source_data(fig, "color")[0]["dtype"] == "int16"
    before_invalid = fig.snapshot()
    with pytest.raises(ValueError, match="matching lengths"):
        layer.set_data(x=[1, 2, 3], y=[4, 5])
    assert fig.snapshot() == before_invalid
    assert source_data(fig, "x")[1] == x_bytes


def test_partial_grid_updates_keep_shape_and_validate_before_replacing_sources():
    fig = vs.Figure()
    layer = fig.heatmap([[1, 2], [3, 4]])
    before_x = source_data(fig, "x")
    values = array("f", [5, 6, 7, 8])
    layer.set_data(z=memoryview(values).cast("B").cast("f", shape=[2, 2]))
    values[0] = 99
    source, _, result = source_data(fig, "z")
    assert source["dtype"] == "float32" and source["shape"] == [2, 2]
    assert result == [5, 6, 7, 8] and source_data(fig, "x") == before_x
    stable = fig.snapshot()
    with pytest.raises(ValueError, match="Grid requires"):
        layer.set_data(z=[[1, 2, 3], [4, 5, 6]])
    with pytest.raises(ValueError, match="strictly increasing"):
        layer.set_data(x=[1, 0])
    assert fig.snapshot() == stable
    layer.set_data(x=[0, 1, 2], z=[[1, 2, 3], [4, 5, 6]])
    assert source_data(fig, "z")[0]["shape"] == [2, 3]
    assert source_data(fig, "x")[2] == [0, 1, 2]


def test_axes_and_style_validation_are_atomic():
    fig = vs.Figure()
    layer = fig.plot([1, 2], [2, 4])
    fig.set_axes(xscale="log", xlim=(1, 10), xlabel="Time")
    before = fig.snapshot()
    json.dumps(before, allow_nan=False)
    with pytest.raises(ValueError, match="positive"):
        fig.set_axes(xlim=(-1, 10))
    assert fig.snapshot() == before
    with pytest.raises(ValueError, match="positive"):
        layer.set_style(size=0)
    with pytest.raises(ValueError, match="between"):
        layer.set_style(opacity=2)
    with pytest.raises(ValueError, match="Colors"):
        layer.set_style(color="javascript:invalid")
    fig.set_axes(xlim=None)
    assert "xDomain" not in fig.snapshot()["figure"]["view"]


def test_defaults_match_javascript_and_closed_figures_reject_mutation():
    fig = vs.Figure()
    spec = fig.snapshot()["figure"]
    assert (spec["width"], spec["height"]) == (800, 520)
    assert spec["view"]["camera"] == {"azimuth": 35, "elevation": 25, "distance": 3}
    assert spec["view"]["xLabel"] == ""
    fig.close()
    with pytest.raises(RuntimeError, match="closed"):
        fig.plot([1])


def test_event_subscription_and_unsubscribe():
    fig = vs.Figure()
    events = []
    unsubscribe = fig.on("selection", events.append)
    fig._emit("selection", {"kind": "density", "count": 50})
    unsubscribe()
    fig._emit("selection", {})
    assert events == [{"kind": "density", "count": 50}]


def test_notebook_host_detection_does_not_load_qt(monkeypatch):
    import sys
    import types
    from vesora.figure import _default_host
    fake_ipython = types.ModuleType("IPython")
    fake_ipython.get_ipython = lambda: types.SimpleNamespace(kernel=object())
    monkeypatch.setitem(sys.modules, "IPython", fake_ipython)
    assert _default_host() == "notebook"
    fake_ipython.get_ipython = lambda: None
    assert _default_host() == "desktop"
    fake_ipython.get_ipython = lambda: types.SimpleNamespace()
    assert _default_host() == "desktop"


def test_viewchange_preserves_zoom_without_echo_and_validates():
    fig = vs.Figure()
    layer = fig.plot([1, 2], [3, 4])
    published = []
    fig._listeners.append(lambda: published.append(True))
    fig._emit("viewchange", {"xDomain": [1.2, 1.8], "unexpected": "ignored"})
    assert not published
    assert fig.snapshot()["figure"]["view"]["xDomain"] == [1.2, 1.8]
    layer.set_data(y=[5, 6])
    assert fig.snapshot()["figure"]["view"]["xDomain"] == [1.2, 1.8]
    before = fig.snapshot()
    with pytest.raises(ValueError, match="finite"):
        fig._emit("viewchange", {"xDomain": [1, float("inf")]})
    assert fig.snapshot() == before
