"""Bounded, inert source declarations and portable observation metadata.

These records describe data; units are not converted and transforms are never run.
"""
from __future__ import annotations

import calendar
import math
import re
from typing import Any

OBSERVATION_PROTOCOL_VERSION = 8
_MAX_SAFE_INTEGER = 2**53 - 1
_SHORT_FIELDS = {"name", "quantity", "unit", "dimension"}
_COUNTS = {"total", "visible", "rendered", "valid", "omitted", "rangeExcluded", "totalTriangles", "omittedTriangles"}
_REPRESENTATIONS = {"line": {"line"}, "line3d": {"line"}, "scatter": {"points", "density"}, "scatter3d": {"points"},
                    "heatmap": {"grid"}, "surface": {"surface"}, "hist": {"hist"}, "bar": {"bar"}, "boxplot": {"boxplot"}, "band": {"band"}}
_JS_WHITESPACE = "\u0009\u000a\u000b\u000c\u000d \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def _object(value: Any, allowed: set[str] | None = None, required: set[str] = frozenset()) -> dict:
    if type(value) is not dict or any(type(key) is not str for key in value):
        raise ValueError("Observation metadata must contain plain string-keyed dictionaries")
    if (allowed is not None and value.keys() - allowed) or not required <= value.keys():
        raise ValueError("Unknown or missing observation metadata fields")
    return value


def _text(value: Any, limit: int | None = None, *, empty: bool = False) -> str:
    if type(value) is not str or not empty and not value.strip(_JS_WHITESPACE):
        raise ValueError("Observation metadata text must be a nonempty string")
    if limit is not None and len(value.encode("utf-16-le", errors="surrogatepass")) // 2 > limit:
        raise ValueError(f"Observation metadata text exceeds {limit} UTF-16 code units")
    return value


def _identifier(value: Any) -> str:
    if type(value) is not str or not value:
        raise ValueError("Observation reference IDs must be nonempty strings")
    return value


def _integer(value: Any, *, positive: bool = False) -> int:
    if type(value) not in (int, float) or not (int(positive) <= value <= _MAX_SAFE_INTEGER) or value != int(value):
        raise ValueError("Observation counts must be nonnegative safe integers")
    return int(value)


def _array(value: Any, limit: int) -> list:
    if type(value) is not list or len(value) > limit:
        raise ValueError("Observation metadata list exceeds its scene-bound limit")
    return value


def _timestamp(value: Any) -> str:
    if type(value) is not str or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z", value):
        raise ValueError("Observation capture time must be an ISO UTC millisecond timestamp")
    year, month, day, hour, minute, second = (int(part) for part in re.findall(r"\d+", value)[:6])
    # The shared JS ISO format includes year 0000, unlike datetime.datetime.
    if not 1 <= month <= 12 or not 1 <= day <= calendar.monthrange(year, month)[1] or hour > 23 or minute > 59 or second > 59:
        raise ValueError("Invalid observation capture time")
    return value


def validate_source_semantics(value: Any) -> dict[str, Any]:
    """Validate and detach a complete source declaration, without executing it."""
    source = _object(value, _SHORT_FIELDS | {"origin", "transforms"})
    if not source:
        raise ValueError("A source declaration needs at least one field")
    result: dict[str, Any] = {}
    for key, item in source.items():
        if key in _SHORT_FIELDS:
            result[key] = _text(item, 256)
        elif key == "origin":
            origin = _object(item, {"datasetId", "field", "reference"}, {"datasetId"})
            result[key] = {name: _text(text, 2048 if name == "reference" else 256) for name, text in origin.items()}
        else:
            transforms = []
            for transform in _array(item, 16):
                transform = _object(transform, {"execution", "name", "version", "parameters"}, {"execution", "name"})
                if type(transform["execution"]) is not str or transform["execution"] != "external":
                    raise ValueError("Transform descriptions must declare external execution")
                cloned: dict[str, Any] = {"execution": "external", "name": _text(transform["name"], 256)}
                if "version" in transform:
                    cloned["version"] = _text(transform["version"], 256)
                if "parameters" in transform:
                    parameters = _object(transform["parameters"])
                    if len(parameters) > 32:
                        raise ValueError("Transform descriptions support at most 32 scalar parameters")
                    detached = {}
                    for name, parameter in parameters.items():
                        _text(name, 64)
                        if type(parameter) is str:
                            parameter = _text(parameter, 1024, empty=True)
                        elif parameter is None or type(parameter) is bool:
                            pass
                        elif type(parameter) in (int, float):
                            try:
                                finite = math.isfinite(parameter)
                            except OverflowError:
                                finite = False
                            if not finite:
                                raise ValueError("Transform numeric parameters must be finite")
                        else:
                            raise ValueError("Transform parameters must be JSON scalars")
                        detached[name] = parameter
                    cloned["parameters"] = detached
                transforms.append(cloned)
            result[key] = transforms
    return result


def same_declaration(left: Any, right: Any) -> bool:
    """Compare already validated JSON declarations without Python's True == 1 alias."""
    if type(left) is dict:
        return type(right) is dict and left.keys() == right.keys() and all(same_declaration(left[key], right[key]) for key in left)
    if type(left) is list:
        return type(right) is list and len(left) == len(right) and all(same_declaration(a, b) for a, b in zip(left, right))
    if type(left) is bool or type(right) is bool:
        return type(left) is type(right) and left == right
    return left == right


def validate_semantics(value: Any, descriptors: list[dict[str, Any]]) -> dict[str, Any]:
    semantics = _object(value, {"schemaVersion", "sources"}, {"schemaVersion", "sources"})
    if _integer(semantics["schemaVersion"]) != 1:
        raise ValueError("Unsupported semantics schema version")
    sources = _object(semantics["sources"])
    existing = {item["id"] for item in descriptors}
    if len(existing) != len(descriptors):
        raise ValueError("Captured source identities must be unique")
    if len(sources) > len(existing) or sources.keys() - existing:
        raise ValueError("Semantics reference an unknown source")
    return {"schemaVersion": 1, "sources": {name: validate_source_semantics(item) for name, item in sources.items()}}


def validate_observation(value: Any, spec: dict[str, Any], descriptors: list[dict[str, Any]]) -> dict[str, Any]:
    record = _object(value, {"schemaVersion", "source", "capturedAt", "sourceVersions", "streams", "representation"},
                     {"schemaVersion", "source", "capturedAt", "sourceVersions", "streams", "representation"})
    if _integer(record["schemaVersion"]) != 1:
        raise ValueError("Unsupported observation schema version")
    if type(record["source"]) is not str or record["source"] not in ("accepted", "displayed"):
        raise ValueError("Unknown observation capture source")
    sources = {item["id"]: item for item in descriptors}
    if len(sources) != len(descriptors):
        raise ValueError("Captured source identities must be unique")
    versions = []
    seen = set()
    for item in _array(record["sourceVersions"], len(sources)):
        item = _object(item, {"id", "version"}, {"id", "version"})
        source_id, version = _identifier(item["id"]), _integer(item["version"])
        if source_id in seen or source_id not in sources or version != sources[source_id]["version"]:
            raise ValueError("Observation source versions do not match the captured descriptors")
        seen.add(source_id)
        versions.append({"id": source_id, "version": version})
    if seen != sources.keys():
        raise ValueError("Observation must cover every captured source exactly once")
    layers = {item["id"]: item for item in spec["layers"]}
    if len(layers) != len(spec["layers"]):
        raise ValueError("Captured layer identities must be unique")
    panels = {item["id"]: spec["view"] if item["id"] == "main" else item.get("view") for item in spec.get("panels", [{"id": "main"}])}
    streams, seen = [], set()
    for stream in _array(record["streams"], len(layers)):
        keys = {"layerId", "streamId", "revision", "sequenceStart", "sequenceEndExclusive"}
        stream = _object(stream, keys, keys)
        layer_id, stream_id = _identifier(stream["layerId"]), _identifier(stream["streamId"])
        layer = layers.get(layer_id)
        if layer_id in seen or layer is None or layer["kind"] not in ("line", "scatter") or layer.get("categorical"):
            raise ValueError("Observation stream must reference a unique numeric 2D line or scatter layer")
        panel = panels.get(layer.get("panelId", "main"))
        if panel is None or panel["kind"] != "2d" or not {"x", "y"} <= layer["data"].keys() or layer["data"].keys() - {"x", "y", "color"}:
            raise ValueError("Observation stream channels or panel are invalid")
        revision, start, end = (_integer(stream[key]) for key in ("revision", "sequenceStart", "sequenceEndExclusive"))
        if end < start:
            raise ValueError("Observation sequence interval is reversed")
        for source_id in layer["data"].values():
            if source_id not in sources or sources[source_id]["shape"] != [end - start]:
                raise ValueError("Observation sequence interval does not match its captured source rows")
        streams.append({"layerId": layer_id, "streamId": stream_id, "revision": revision, "sequenceStart": start, "sequenceEndExclusive": end})
        seen.add(layer_id)
    representation = _object(record["representation"])
    status = representation.get("status")
    if type(status) is not str:
        raise ValueError("Unknown observation representation status")
    if status == "not-evaluated":
        _object(representation, {"status"}, {"status"})
        detached_representation = {"status": status}
    elif status == "rendered":
        _object(representation, {"status", "frameId", "snapshotId", "layers"}, {"status", "frameId", "layers"})
        if record["source"] != "displayed":
            raise ValueError("Accepted observations cannot claim a rendered representation")
        detached_representation = {"status": status, "frameId": _integer(representation["frameId"]), "layers": []}
        if "snapshotId" in representation:
            detached_representation["snapshotId"] = _identifier(representation["snapshotId"])
        seen = set()
        for item in _array(representation["layers"], len(layers)):
            item = _object(item, _COUNTS | {"kind", "exact", "method", "layerId", "panelId"}, {"kind", "total", "visible", "rendered", "exact", "method", "layerId"})
            layer_id = _identifier(item["layerId"])
            layer = layers.get(layer_id)
            panel_id = _identifier(item.get("panelId", "main"))
            if layer_id in seen or layer is None or panel_id not in panels or panel_id != layer.get("panelId", "main"):
                raise ValueError("Representation layer or panel reference is invalid")
            if type(item["kind"]) is not str or item["kind"] not in _REPRESENTATIONS.get(layer["kind"], set()) or type(item["exact"]) is not bool:
                raise ValueError("Representation kind must match its layer and exactness must be boolean")
            detached = {key: _integer(number) for key, number in item.items() if key in _COUNTS}
            detached.update(kind=item["kind"], exact=item["exact"], method=_text(item["method"], 256), layerId=layer_id)
            if "panelId" in item:
                detached["panelId"] = panel_id
            detached_representation["layers"].append(detached)
            seen.add(layer_id)
    else:
        raise ValueError("Unknown observation representation status")
    return {"schemaVersion": 1, "source": record["source"], "capturedAt": _timestamp(record["capturedAt"]),
            "sourceVersions": versions, "streams": streams, "representation": detached_representation}


def validate_figure_metadata(spec: dict[str, Any], descriptors: list[dict[str, Any]]) -> None:
    """Validate optional protocol-8 metadata against a captured scene, without mutation."""
    if ("semantics" in spec or "observation" in spec) and spec.get("protocolVersion") != OBSERVATION_PROTOCOL_VERSION:
        raise ValueError("Observation metadata requires scene protocol 8")
    if "semantics" in spec or "observation" in spec:
        if len({item["id"] for item in spec["layers"]}) != len(spec["layers"]):
            raise ValueError("Captured layer identities must be unique")
    if "semantics" in spec:
        validate_semantics(spec["semantics"], descriptors)
    if "observation" in spec:
        validate_observation(spec["observation"], spec, descriptors)


def make_accepted_observation(spec: dict[str, Any], descriptors: list[dict[str, Any]], streams: dict[str, dict[str, Any]], captured_at: str) -> dict[str, Any]:
    """Use only scene/source/stream copies captured under one figure lock."""
    record = {"schemaVersion": 1, "source": "accepted", "capturedAt": captured_at,
              "sourceVersions": [{"id": source["id"], "version": source["version"]} for source in descriptors],
              "streams": [{"layerId": layer_id, "streamId": state["streamId"], "revision": state["revision"],
                           "sequenceStart": state["nextSequence"] - state["retained"], "sequenceEndExclusive": state["nextSequence"]}
                          for layer_id, state in streams.items()], "representation": {"status": "not-evaluated"}}
    return validate_observation(record, spec, descriptors)
