"""Optional ndarray interoperability; the baseline suite uses only stdlib inputs."""
import math
import struct

import pytest

np = pytest.importorskip("numpy")

import vesora as vs


_FORMATS = {"float64": "d", "float32": "f", "int32": "i", "uint32": "I",
            "int16": "h", "uint16": "H", "int8": "b", "uint8": "B"}


def wire_data(fig, channel):
    snapshot = fig.snapshot()
    source_id = snapshot["figure"]["layers"][0]["data"][channel]
    descriptor = next(source for source in snapshot["sources"] if source["id"] == source_id)
    payload = fig._data_bytes(source_id, descriptor["version"])
    length = math.prod(descriptor["shape"])
    assert len(payload) == descriptor["byteLength"]
    return descriptor, payload, list(struct.unpack("<" + _FORMATS[descriptor["dtype"]] * length, payload))


@pytest.mark.parametrize("dtype", list(_FORMATS))
def test_ndarray_eight_wire_dtypes_preserve_values_and_copy_mutable_input(dtype):
    original = np.array([1, 2, 3], dtype=dtype)
    fig = vs.Figure()
    fig.scatter(original, original)
    source, payload, values = wire_data(fig, "x")
    assert source["dtype"] == dtype and source["shape"] == [3]
    assert payload == struct.pack("<3" + _FORMATS[dtype], 1, 2, 3)
    assert values == [1, 2, 3]
    original[:] = 9
    assert wire_data(fig, "x")[1] == payload
    assert wire_data(fig, "y")[1] == payload


@pytest.mark.parametrize("dtype,wire", [("f8", "float64"), ("f4", "float32"), ("i4", "int32"),
                                       ("u4", "uint32"), ("i2", "int16"), ("u2", "uint16")])
@pytest.mark.parametrize("byteorder", ["<", ">"])
def test_explicit_endianness_is_converted_to_little_endian(dtype, wire, byteorder):
    values = np.array([1, 2, 7], dtype=byteorder + dtype)
    fig = vs.Figure()
    fig.plot(values)
    source, payload, result = wire_data(fig, "y")
    assert source["dtype"] == wire
    assert payload == struct.pack("<3" + _FORMATS[wire], 1, 2, 7)
    assert result == [1, 2, 7]


@pytest.mark.parametrize("stride", [2, -2])
def test_strided_big_endian_1d_arrays_use_logical_order(stride):
    values = np.arange(10, dtype=">f8")[::stride]
    expected = values.tolist()
    fig = vs.Figure()
    fig.plot(values)
    source, payload, result = wire_data(fig, "y")
    assert source["shape"] == [5] and source["dtype"] == "float64"
    assert payload == struct.pack("<5d", *expected) and result == expected


@pytest.mark.parametrize("layout", ["fortran", "transpose", "strided", "reversed"])
def test_multidimensional_ndarrays_are_canonical_row_major_grids(layout):
    original = np.arange(12, dtype=np.float32).reshape(3, 4)
    if layout == "fortran":
        values = np.asfortranarray(original)
    elif layout == "transpose":
        values = original.T
    elif layout == "strided":
        values = original[::2, ::2]
    else:
        values = original[::-1, ::-1]
    expected = values.ravel(order="C").tolist()
    fig = vs.Figure()
    fig.heatmap(values)
    source, payload, result = wire_data(fig, "z")
    assert source["shape"] == list(values.shape) and source["dtype"] == "float32"
    assert payload == struct.pack("<" + "f" * len(expected), *expected)
    assert result == expected
    values[:] = 99
    assert wire_data(fig, "z")[1] == payload


@pytest.mark.parametrize("dtype,wire,values", [("bool", "uint8", [True, False, True]),
                                             ("float16", "float32", [0.1, -2, 65504])])
def test_bool_and_float16_have_supported_wire_promotions(dtype, wire, values):
    original = np.array(values, dtype=dtype)
    fig = vs.Figure()
    fig.plot(original)
    source, payload, result = wire_data(fig, "y")
    expected = original.astype(wire).tolist()
    assert source["dtype"] == wire and result == expected
    assert payload == struct.pack("<3" + _FORMATS[wire], *expected)


@pytest.mark.parametrize("dtype,values", [("int64", [-(2**53), 0, 2**53]), ("uint64", [0, 2**53])])
@pytest.mark.parametrize("byteorder", ["<", ">"])
def test_64bit_integers_promote_only_within_the_exact_float64_range(dtype, values, byteorder):
    fig = vs.Figure()
    original = np.array(values, dtype=np.dtype(dtype).newbyteorder(byteorder))
    fig.plot(original)
    source, _, result = wire_data(fig, "y")
    assert source["dtype"] == "float64" and result == values
    invalid = [2**53 + 1, 2**64 - 1] if dtype == "uint64" else [-(2**53) - 1, 2**53 + 1]
    stable = fig.snapshot()
    for value in invalid:
        with pytest.raises(ValueError, match="exact Float64"):
            fig.plot(np.array([value], dtype=np.dtype(dtype).newbyteorder(byteorder)))
    assert fig.snapshot() == stable


@pytest.mark.parametrize("values", [np.array([1 + 2j]), np.array(["1", "2"]),
                                    np.array([1, 2], dtype=object),
                                    np.array(["2026-01-01"], dtype="datetime64[D]")])
def test_unsupported_ndarray_kinds_do_not_publish_sources(values):
    fig = vs.Figure()
    with pytest.raises(TypeError):
        fig.plot(values)
    assert fig.snapshot()["sources"] == []


def test_ragged_object_grid_and_invalid_ndarray_dimensions_are_rejected():
    fig = vs.Figure()
    ragged = np.empty(2, dtype=object)
    ragged[:] = [[1], [2, 3]]
    with pytest.raises((ValueError, TypeError)):
        fig.heatmap(ragged)
    with pytest.raises(ValueError, match="1D"):
        fig.scatter(np.ones((2, 1)), np.ones((2, 1)))
    with pytest.raises(ValueError, match="2D"):
        fig.heatmap(np.ones((1, 2, 3)))
    assert fig.snapshot()["sources"] == []


def test_partial_ndarray_update_preserves_identity_and_unmodified_channels():
    fig = vs.Figure()
    layer = fig.scatter(np.array([1, 2], dtype=np.float64), np.array([3, 4], dtype=np.float64))
    x_before = wire_data(fig, "x")
    y_before = wire_data(fig, "y")[0]
    replacement = np.array([5, 9, 6, 9], dtype=">f4")[::2]
    layer.set_data(y=replacement)
    replacement[:] = 99
    source, _, result = wire_data(fig, "y")
    assert source["id"] == y_before["id"] and source["version"] == y_before["version"] + 1
    assert source["dtype"] == "float32" and result == [5, 6]
    assert wire_data(fig, "x") == x_before
