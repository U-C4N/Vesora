"""Owned numeric buffers without a required numerical-computing dependency.

The wire representation is C-order, little-endian bytes. Buffer exporters such
as array.array, memoryview and NumPy ndarray are adapted through PEP 3118; this
module neither imports NumPy nor borrows mutable caller storage.
"""
from __future__ import annotations

from array import array
from collections.abc import Mapping
from dataclasses import dataclass
import math
from numbers import Integral, Real
import struct
import sys
from typing import Any, Iterator


@dataclass(frozen=True, slots=True)
class NumericDType:
    name: str
    itemsize: int
    code: str


_DTYPES = {
    "float64": NumericDType("float64", 8, "d"),
    "float32": NumericDType("float32", 4, "f"),
    "int32": NumericDType("int32", 4, "i"),
    "uint32": NumericDType("uint32", 4, "I"),
    "int16": NumericDType("int16", 2, "h"),
    "uint16": NumericDType("uint16", 2, "H"),
    "int8": NumericDType("int8", 1, "b"),
    "uint8": NumericDType("uint8", 1, "B"),
}
_EXACT_INTEGER_LIMIT = 2**53


@dataclass(frozen=True, slots=True)
class NumericData:
    """Small internal array facade backed exclusively by immutable bytes."""
    dtype: NumericDType
    shape: tuple[int, ...]
    _buffer: bytes

    def __post_init__(self) -> None:
        if self.dtype.name not in _DTYPES or self.dtype != _DTYPES[self.dtype.name]:
            raise ValueError("Unsupported canonical dtype")
        if not isinstance(self._buffer, bytes):
            raise TypeError("Canonical numeric storage must be immutable bytes")
        if not isinstance(self.shape, tuple) or any(not isinstance(n, int) or n < 0 for n in self.shape):
            raise ValueError("Canonical shape must contain nonnegative integers")
        if math.prod(self.shape) * self.dtype.itemsize != len(self._buffer):
            raise ValueError("Canonical shape and byte length do not match")

    @property
    def ndim(self) -> int:
        return len(self.shape)

    @property
    def size(self) -> int:
        return math.prod(self.shape)

    @property
    def nbytes(self) -> int:
        return len(self._buffer)

    def tobytes(self, order: str = "C") -> bytes:
        if order != "C":
            raise ValueError("Canonical numeric storage supports C order only")
        return self._buffer

    def __iter__(self) -> Iterator[int | float]:
        for item in struct.iter_unpack("<" + self.dtype.code, self._buffer):
            yield item[0]

    def __len__(self) -> int:
        if not self.shape:
            raise TypeError("A scalar has no length")
        return self.shape[0]


def _integer(value: int, name: str) -> int:
    if not -_EXACT_INTEGER_LIMIT <= value <= _EXACT_INTEGER_LIMIT:
        raise ValueError(f"{name}: int64/uint64 values outside the exact Float64 integer range are unsupported")
    return value


def _little_bytes(values: array) -> bytes:
    if sys.byteorder != "little" and values.itemsize > 1:
        values.byteswap()
    return values.tobytes()


def _from_buffer(view: memoryview, name: str) -> NumericData:
    fmt = view.format
    prefix = fmt[0] if fmt and fmt[0] in "@=<>!" else "@"
    code = fmt[1:] if fmt and fmt[0] in "@=<>!" else fmt
    # Structured, complex, object, character, pointer and extended precision
    # formats are deliberately rejected instead of guessing their semantics.
    if len(code) != 1 or code not in "?bBhHiIlLqQnNefd":
        raise TypeError(f"{name} must contain real numeric values; unsupported buffer format {fmt!r}")
    width = view.itemsize
    if code == "?":
        kind, valid_widths = "bool", (1,)
    elif code in "efd":
        kind, valid_widths = "float", {"e": (2,), "f": (4,), "d": (8,)}[code]
    else:
        kind = "int" if code in "bhilqn" else "uint"
        valid_widths = {"b": (1,), "h": (2,), "i": (2, 4, 8), "l": (4, 8), "q": (8,), "n": (4, 8)}[code.lower()]
    if width not in valid_widths:
        raise TypeError(f"Unsupported item size for {name}: format {fmt!r}, {width} bytes")
    shape = tuple(view.shape or ())
    raw = view.tobytes(order="C")
    byteorder = "big" if prefix in (">", "!") else "little" if prefix == "<" else sys.byteorder
    source_prefix = ">" if byteorder == "big" else "<"
    if kind == "bool":
        # Normalize any nonzero boolean storage byte to one.
        return NumericData(_DTYPES["uint8"], shape, bytes(1 if value else 0 for value in raw))
    if kind in ("int", "uint") and width == 8:
        source_code = "q" if kind == "int" else "Q"
        values = array("d", (_integer(value[0], name) for value in struct.iter_unpack(source_prefix + source_code, raw)))
        return NumericData(_DTYPES["float64"], shape, _little_bytes(values))
    if kind == "float" and width == 2:
        values = array("f", (value[0] for value in struct.iter_unpack(source_prefix + "e", raw)))
        return NumericData(_DTYPES["float32"], shape, _little_bytes(values))
    dtype = _DTYPES[f"{kind}{width * 8}"]
    if byteorder != "little" and width > 1:
        # array.byteswap runs in C and preserves IEEE NaN/infinity payload bits.
        swapped = array(dtype.code)
        swapped.frombytes(raw)
        swapped.byteswap()
        raw = swapped.tobytes()
    return NumericData(dtype, shape, raw)


def _from_sequence(value: Any, name: str) -> NumericData:
    values = array("d")
    only_booleans = True

    def append_scalar(item: Any, *, boolean: bool = False) -> None:
        nonlocal only_booleans
        only_booleans = only_booleans and boolean
        if isinstance(item, Integral):
            item = _integer(int(item), name)
        values.append(float(item))

    def visit(item: Any, depth: int = 0) -> tuple[int, ...]:
        if depth > 32:
            raise ValueError(f"{name}: numeric sequences are nested too deeply")
        if isinstance(item, bool):
            append_scalar(item, boolean=True)
            return ()
        if isinstance(item, Real):
            append_scalar(item)
            return ()
        if isinstance(item, (str, bytes, bytearray, Mapping)):
            raise TypeError(f"{name} must contain real numeric values")
        # Accept numeric buffers nested inside a Python sequence, including
        # zero-dimensional scalar exporters and multidimensional memoryviews
        # that cannot themselves be iterated by Python.
        try:
            scalar_view = memoryview(item)
        except TypeError:
            scalar_view = None
        except (ValueError, BufferError) as exc:
            raise TypeError(f"{name} must contain real numeric values; the buffer format is unsupported") from exc
        if scalar_view is not None:
            try:
                nested = _from_buffer(scalar_view, name)
                boolean = scalar_view.format.lstrip("@=<>!") == "?"
                for scalar in nested:
                    append_scalar(scalar, boolean=boolean)
                return nested.shape
            finally:
                scalar_view.release()
        try:
            children = iter(item)
        except TypeError:
            raise TypeError(f"{name} must contain real numeric values") from None
        length = 0
        child_shape: tuple[int, ...] | None = None
        for child in children:
            shape = visit(child, depth + 1)
            if child_shape is None:
                child_shape = shape
            elif shape != child_shape:
                raise ValueError(f"{name}: nested numeric sequences must be rectangular (ragged data is unsupported)")
            length += 1
        return (length,) + (child_shape or ())

    shape = visit(value)
    if values and only_booleans:
        return NumericData(_DTYPES["uint8"], shape, bytes(int(item) for item in values))
    return NumericData(_DTYPES["float64"], shape, _little_bytes(values))


def as_numeric(value: Any, name: str) -> NumericData:
    """Normalize arrays, buffers and rectangular iterables without importing NumPy."""
    if isinstance(value, NumericData):
        return value  # Safe to reuse: shape, dtype and owned bytes are immutable.
    try:
        view = memoryview(value)
    except TypeError:
        return _from_sequence(value, name)
    except (ValueError, BufferError) as exc:
        raise TypeError(f"{name} must contain real numeric values; the buffer format is unsupported") from exc
    try:
        return _from_buffer(view, name)
    finally:
        view.release()


def numeric_range(length: int) -> NumericData:
    values = array("d", range(length))
    return NumericData(_DTYPES["float64"], (length,), _little_bytes(values))
