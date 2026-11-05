"""Explicit run alignment and stable observation identities; no inferred joins."""
from __future__ import annotations

from bisect import bisect_left
import copy
import json
import math
from typing import Any

from .advanced import vector, number

_QUERY_UNSET = object()


def query_ecdf(samples: Any, *, probability: Any = _QUERY_UNSET, threshold: Any = _QUERY_UNSET) -> dict[str, Any]:
    """Query finite raw samples using nearest-rank quantiles and exact <= counts.

    Membership remains complete in source_count; sourceIndices is an original-
    order preview of at most 10,000 rows. When both queries are supplied, the
    preview identifies threshold membership and quantile is reported separately.
    """
    if probability is not _QUERY_UNSET:
        probability = number(probability, "probability")
        if not 0 <= probability <= 1:
            raise ValueError("probability must be in [0, 1]")
    if threshold is not _QUERY_UNSET:
        threshold = number(threshold, "threshold")
    values = list(vector(samples, "samples"))
    indices = [i for i,value in enumerate(values) if math.isfinite(value)]
    count = len(indices)
    result = {"count":count,"omitted":len(values)-count}
    quantile = None
    if probability is not _QUERY_UNSET:
        ordered = sorted(values[i] for i in indices)
        quantile = ordered[max(0,math.ceil(probability*count)-1)] if count else None
        result["quantile"] = quantile
    if threshold is not _QUERY_UNSET:
        membership = [i for i in indices if values[i] <= threshold]
        cumulative = len(membership)
        result.update(cumulativeCount=cumulative,exceedanceCount=count-cumulative,probability=cumulative/count if count else None)
        source_kind = "at-or-below"
    elif probability is not _QUERY_UNSET:
        membership = [i for i in indices if values[i] == quantile] if quantile is not None else []
        source_kind = "quantile-ties"
    else:
        membership, source_kind = [], "none"
    result.update(sourceIndices=membership[:10000],sourceCount=len(membership),truncated=len(membership)>10000,sourceKind=source_kind)
    return result


def create_run_comparison(runs: Any, *, alignment: str = "exact", reference_run_id: str | None = None,
                          tolerance: float = 0, max_gap: float | None = None, event_offsets: dict[str, float] | None = None,
                          allow_unit_mismatch: bool = False) -> dict[str, Any]:
    """Align owned source values; return residual deltas, ratios and lineage.

    An event offset is subtracted from each run's x. Linear interpolation only
    uses consecutive finite samples and never crosses a missing sample.
    """
    if not isinstance(runs, (list, tuple)) or len(runs) < 2:
        raise ValueError("A comparison requires at least two runs")
    if alignment not in ("exact", "nearest", "linear"):
        raise ValueError("Unknown comparison alignment")
    tolerance = number(tolerance, "tolerance", nonnegative=True)
    gap_limit = math.inf if max_gap is None else number(max_gap, "max_gap", nonnegative=True)
    if type(allow_unit_mismatch) is not bool:
        raise TypeError("allow_unit_mismatch must be boolean")
    owned, ids = [], set()
    for run in runs:
        if not isinstance(run, dict) or not isinstance(run.get("id"), str) or not run["id"] or run["id"] in ids:
            raise ValueError("Runs require unique nonempty IDs")
        ids.add(run["id"])
        for key in ("unit", "xUnit", "label"):
            if key in run and not isinstance(run[key], str):
                raise ValueError(f"{key} must be a string")
        offset = number((event_offsets or {}).get(run["id"], run.get("eventOffset", run.get("event_offset", 0))), "event_offset")
        x, y = list(vector(run.get("x"), "x")), list(vector(run.get("y"), "y"))
        if len(x) != len(y):
            raise ValueError("Run x/y lengths must match")
        x = [value-offset for value in x]
        if any(not math.isfinite(value) or i > 0 and value <= x[i-1] for i, value in enumerate(x)):
            raise ValueError("Run x must remain finite and strictly increasing after the event shift")
        item = {"id": run["id"], "label": run.get("label", run["id"]), "x": x, "y": y, "eventOffset": offset}
        item.update({key: run[key] for key in ("unit", "xUnit") if key in run})
        owned.append(item)
    if set(event_offsets or {}) - ids:
        raise ValueError("Event offset references an unknown run")
    reference_run_id = owned[0]["id"] if reference_run_id is None else reference_run_id
    reference = next((run for run in owned if run["id"] == reference_run_id), None)
    if reference is None:
        raise ValueError("Unknown reference run")
    if not allow_unit_mismatch and any(run.get("unit") != reference.get("unit") or run.get("xUnit") != reference.get("xUnit") for run in owned):
        raise ValueError("Run units differ; declare matching units or explicitly allow_unit_mismatch. Values are never converted.")

    def sample(run: dict[str, Any], x: float) -> dict[str, Any]:
        xs, ys = run["x"], run["y"]
        right = bisect_left(xs, x)
        missing = {"value": None, "sourceIndices": [], "interpolated": False}
        if right < len(xs) and xs[right] == x:
            return {"value": ys[right] if math.isfinite(ys[right]) else None, "sourceIndices": [right], "interpolated": False, "distance": 0}
        if alignment == "exact":
            return missing
        left = right-1
        if alignment == "nearest":
            index = left if left >= 0 and (right == len(xs) or x-xs[left] <= xs[right]-x) else right
            if not 0 <= index < len(xs) or abs(xs[index]-x) > tolerance:
                return missing
            if left >= 0 and right < len(xs) and (not math.isfinite(ys[left]) or not math.isfinite(ys[right])):
                return missing
            return {"value": ys[index] if math.isfinite(ys[index]) else None, "sourceIndices": [index], "interpolated": False, "distance": abs(xs[index]-x)}
        if left < 0 or right >= len(xs) or xs[right]-xs[left] > gap_limit or not math.isfinite(ys[left]) or not math.isfinite(ys[right]):
            return missing
        span = xs[right]-xs[left]
        t = (x-xs[left])/span if math.isfinite(span) else (x/2-xs[left]/2)/(xs[right]/2-xs[left]/2)
        value = (1-t)*ys[left]+t*ys[right]
        return {"value": value if math.isfinite(value) else None, "sourceIndices": [left, right], "interpolated": True}

    rows = []
    for x in reference["x"]:
        samples = {run["id"]: sample(run, x) for run in owned}
        values = {key: value["value"] for key, value in samples.items()}
        base = values[reference_run_id]
        deltas = {key: None if value is None or base is None else value-base for key, value in values.items()}
        deltas = {key: value if value is None or math.isfinite(value) else None for key, value in deltas.items()}
        ratios = {key: None if value is None or base is None or base == 0 else value/base for key, value in values.items()}
        ratios = {key: value if value is None or math.isfinite(value) else None for key, value in ratios.items()}
        rows.append({"x": x, "values": values, "deltas": deltas, "ratios": ratios, "samples": samples})
    return {"referenceRunId": reference_run_id, "alignment": alignment, "rows": rows, "runs": owned,
            "lineage": {"algorithm": "vesora-run-comparison", "version": 1, "alignment": alignment, "referenceRunId": reference_run_id,
                        "inputs": [{"runId": run["id"], "count": len(run["x"]), "eventOffset": run["eventOffset"]} for run in owned],
                        "parameters": {"tolerance": tolerance if alignment == "nearest" else None,
                                       "maxGap": max_gap if alignment == "linear" else None, "unitConversion": False}}}


def _ids(values: Any, name: str) -> list[str]:
    if not isinstance(values, (list, tuple)) or any(not isinstance(value, str) or not value for value in values) or len(set(values)) != len(values):
        raise ValueError(f"{name} must contain unique nonempty string IDs")
    return list(values)


def row_count(figure: Any, layer: dict[str, Any]) -> int:
    kind = layer["kind"]
    channel = {"ecdf": "samples", "parallelCoordinates": "c0", "ternary": "a", "spectrogram": "y", "contour": "z"}.get(kind, "x" if "x" in layer["data"] else "samples")
    if channel not in layer["data"]:
        raise ValueError("Layer has no observation-row domain")
    data = figure._sources[layer["data"][channel]][1]
    return data.size if kind == "contour" else data.shape[0]


def validate_groups(figure: Any, groups: Any) -> list[dict[str, Any]]:
    if not isinstance(groups, (list, tuple)):
        raise ValueError("Observation groups must be an array")
    layers = {layer["id"]: layer for layer in figure._spec["layers"]}
    group_ids, used, result = set(), set(), []
    for group in groups:
        if not isinstance(group, dict) or group.keys() - {"id", "datasetId", "rowIds", "members", "selectedIds", "generation", "sequence"}:
            raise ValueError("Invalid observation group")
        for key in ("id", "datasetId"):
            if not isinstance(group.get(key), str) or not group[key]:
                raise ValueError(f"{key} must be nonempty text")
        if group["id"] in group_ids:
            raise ValueError("Observation group IDs must be unique")
        group_ids.add(group["id"])
        for key in ("generation", "sequence"):
            if type(group.get(key)) is not int or not 0 <= group[key] <= 2**53-1:
                raise ValueError("Observation generation/sequence must be nonnegative safe integers")
        row_ids = _ids(group.get("rowIds"), "Dataset row IDs")
        domain, members = set(row_ids), []
        if not isinstance(group.get("members"), (list, tuple)) or not group["members"]:
            raise ValueError("Observation groups require members")
        for member in group["members"]:
            if not isinstance(member, dict) or set(member) != {"layerId", "rowIds"}:
                raise ValueError("Invalid observation member")
            layer_id = member["layerId"]
            if layer_id not in layers or layer_id in used:
                raise ValueError("Members must reference unique existing layers")
            used.add(layer_id)
            if layers[layer_id]["kind"] in ("spectrogram", "contour"):
                raise ValueError("Cell/window layers have a separate identity domain and cannot join raw observation rows")
            member_ids = _ids(member["rowIds"], "Member row IDs")
            if len(member_ids) != row_count(figure, layers[layer_id]) or set(member_ids) - domain:
                raise ValueError("Member row IDs must match sources and belong to the dataset dictionary")
            members.append({"layerId": layer_id, "rowIds": member_ids})
        item = {**group, "rowIds": row_ids, "members": members}
        if "selectedIds" in group:
            item["selectedIds"] = _ids(group["selectedIds"], "Selected row IDs")
            if set(item["selectedIds"]) - domain:
                raise ValueError("Selected IDs must belong to the dataset dictionary")
        result.append(copy.deepcopy(item))
    return result


def _advanced_membership(figure: Any, layer: dict[str, Any], bounds: dict[str, Any]) -> list[int]:
    """Complete source membership for the shared renderer's inclusive mark bounds.

    This prepares no drawing geometry. It evaluates the original row predicate
    when the transport's mark preview is truncated, retaining tied ECDF rows.
    """
    data = {name: list(figure._sources[source][1]) for name, source in layer["data"].items()}
    kind, options, selected = layer["kind"], layer["options"], set()
    def intersects(x0, y0, x1=None, y1=None):
        x1, y1 = (x0 if x1 is None else x1), (y0 if y1 is None else y1)
        return all(math.isfinite(v) for v in (x0, y0, x1, y1)) and min(x0,x1) <= bounds["x"][1] and max(x0,x1) >= bounds["x"][0] and min(y0,y1) <= bounds["y"][1] and max(y0,y1) >= bounds["y"][0]
    if kind == "ecdf":
        samples = data["samples"]
        ordered = sorted((i for i, value in enumerate(samples) if math.isfinite(value)), key=lambda i: (samples[i], i))
        total, start, previous, previous_rows = len(ordered), 0, None, []
        before = 1 if options["complementary"] else 0
        while start < total:
            end = start+1
            value = samples[ordered[start]]
            while end < total and samples[ordered[end]] == value:
                end += 1
            after = (total-end)/total if options["complementary"] else end/total
            if previous is not None and intersects(previous,before,value,before):
                selected.update(previous_rows)
            if intersects(value,before,value,after) or intersects(value,after):
                selected.update(ordered[start:end])
            previous, previous_rows, before, start = value, ordered[start:end], after, end
        return sorted(selected)
    if kind == "parallelCoordinates":
        raise ValueError("Use source-axis range predicates for parallel coordinates")
    if kind == "ternary":
        previous = None
        for i, (a,b,c) in enumerate(zip(data["a"],data["b"],data["c"])):
            if not all(math.isfinite(v) for v in (a,b,c)):
                previous = None; continue
            total = a+b+c
            x, y = (b+c*.5)/total, c/total*math.sqrt(3)/2
            if intersects(x,y) or options["connect"] and previous is not None and intersects(*previous,x,y):
                selected.add(i)
            previous = (x,y)
        return sorted(selected)
    if kind == "eventTimeline":
        return [i for i, (x,y,end) in enumerate(zip(data["x"],data["y"],data["end"])) if intersects(x,y-.3,end,y+.3)]
    if kind == "errorbar":
        for i, (x,y) in enumerate(zip(data["x"],data["y"])):
            if any(not math.isfinite(values[i]) for values in data.values()):
                continue
            if intersects(x,y) or "xLower" in data and intersects(data["xLower"][i],y,data["xUpper"][i],y) or "yLower" in data and intersects(x,data["yLower"][i],x,data["yUpper"][i]):
                selected.add(i)
        return sorted(selected)
    if kind == "quiver":
        for i, (x,y,u,v) in enumerate(zip(data["x"],data["y"],data["u"],data["v"])):
            if not all(math.isfinite(value) for value in (x,y,u,v)):
                continue
            magnitude = math.hypot(u,v)
            factor = options["scale"]/(magnitude if options["normalize"] and magnitude else 1)
            if intersects(x,y,x+u*factor,y+v*factor):
                selected.add(i)
        return sorted(selected)
    x, y = data["x"], data["y"]
    valid = [i for i in range(len(x)) if math.isfinite(x[i]) and math.isfinite(y[i])]
    if kind == "paretoFront":
        sx, sy = [1 if objective == "min" else -1 for objective in options["objectives"]]
        ordered = sorted(valid,key=lambda i:(sx*x[i],sy*y[i],i))
        frontier, start, best = set(), 0, math.inf
        while start < len(ordered):
            end = start+1
            while end < len(ordered) and x[ordered[end]] == x[ordered[start]]:
                end += 1
            local = min(sy*y[i] for i in ordered[start:end])
            if local < best:
                frontier.update(i for i in ordered[start:end] if sy*y[i] == local)
            best, start = min(best,local), end
        selected.update(i for i in valid if (options["showAll"] or i in frontier) and intersects(x[i],y[i]))
        if options["connect"]:
            previous = None
            for i in ordered:
                if i in frontier:
                    if previous is not None and intersects(x[previous],y[previous],x[i],y[i]):
                        selected.add(i)
                    previous = i
        return sorted(selected)
    previous = None
    for i in range(len(x)):
        if not math.isfinite(x[i]) or not math.isfinite(y[i]):
            previous = None; continue
        if intersects(x[i],y[i]) or previous is not None and intersects(x[previous],y[previous],x[i],y[i]):
            selected.add(i)
        previous = i
    if options.get("closed") and len(valid) == len(x) and len(x) > 2 and intersects(x[-1],y[-1],x[0],y[0]):
        selected.add(len(x)-1)
    return sorted(selected)


class ObservationController:
    def __init__(self, figure: Any, *, dataset_id: str, row_ids: Any, members: Any, id: str | None = None):
        self.figure, self.id, self._disposed = figure, id or f"observations-{len(figure._spec.get('observationGroups', []))}", False
        row_ids = _ids(row_ids, "Dataset row IDs")
        canonical = []
        for member in members:
            if hasattr(member, "id"):
                member = {"layer": member}
            layer = member.get("layer")
            if layer is not None and layer.figure is not figure:
                raise ValueError("Observation members must belong to this figure")
            canonical.append({"layerId": member.get("layerId", member.get("layer_id", getattr(layer, "id", ""))),
                              "rowIds": list(member.get("rowIds", member.get("row_ids", row_ids)))})
        group = {"id": self.id, "datasetId": dataset_id, "rowIds": row_ids, "members": canonical, "generation": 0, "sequence": 0}
        with figure._lock:
            if any(item["id"] == self.id for item in figure._spec.get("observationGroups", [])):
                raise ValueError("Observation group ID already exists")
            figure.set_observation_groups([*figure._spec.get("observationGroups", []), group])
            self._baseline = self._source_token(group)
        self._unsubscribe = figure.on("selection", self._on_selection)

    def _source_token(self, group: dict[str, Any]) -> str:
        layers = {layer["id"]: layer for layer in self.figure._spec["layers"]}
        return json.dumps([[member["layerId"], layers[member["layerId"]]["kind"],
                            [[key, source, self.figure._sources[source][0]["version"], self.figure._sources[source][0]["shape"]]
                             for key, source in layers[member["layerId"]]["data"].items()]] for member in group["members"]], separators=(",", ":"))

    def _current(self) -> dict[str, Any]:
        if self._disposed:
            raise RuntimeError("Observation controller is disposed")
        self.figure._ensure_open()
        group = next((item for item in self.figure._spec.get("observationGroups", []) if item["id"] == self.id), None)
        if group is None:
            raise RuntimeError("Observation group was removed")
        if self._source_token(group) != self._baseline:
            raise RuntimeError("STALE_OBSERVATIONS: source rows changed; relink with current IDs")
        return group

    def _commit(self, selected: list[str] | None) -> None:
        with self.figure._lock:
            group = copy.deepcopy(self._current())
            if group["sequence"] >= 2**53-1:
                raise ValueError("Observation sequence exhausted")
            group["sequence"] += 1
            if selected is None:
                group.pop("selectedIds", None)
            else:
                group["selectedIds"] = selected
            self.figure.set_observation_groups([group if item["id"] == self.id else item for item in self.figure._spec["observationGroups"]])

    def select_ids(self, ids: Any) -> None:
        selected = set(_ids(ids, "Selected row IDs"))
        with self.figure._lock:
            group = self._current()
            if selected - set(group["rowIds"]):
                raise ValueError("Unknown observation row ID")
            self._commit([row_id for row_id in group["rowIds"] if row_id in selected])

    def set_predicate(self, predicate: dict[str, Any] | None) -> None:
        if predicate is None:
            self.clear(); return
        with self.figure._lock:
            group = self._current()
            layer_id = predicate.get("layerId", predicate.get("layer_id"))
            member = next((member for member in group["members"] if member["layerId"] == layer_id), None)
            layer = next((layer for layer in self.figure._spec["layers"] if layer["id"] == layer_id), None)
            if member is None or layer is None or not isinstance(predicate.get("ranges"), dict) or not predicate["ranges"]:
                raise ValueError("Predicate requires a member layer and channel ranges")
            channels = []
            for name, bounds in predicate["ranges"].items():
                if layer["kind"] == "parallelCoordinates":
                    name = next((f"c{i}" for i, axis in enumerate(layer["options"]["axes"]) if axis["key"] == name), name)
                if name not in layer["data"] or not isinstance(bounds, (list, tuple)) or len(bounds) != 2:
                    raise ValueError("Unknown channel or invalid predicate range")
                low, high = number(bounds[0], "range"), number(bounds[1], "range")
                if low > high:
                    raise ValueError("Predicate ranges must be ordered")
                values = list(self.figure._sources[layer["data"][name]][1])
                if len(values) != len(member["rowIds"]):
                    raise ValueError("Predicate channel must share the observation-row domain")
                channels.append((values, low, high))
            self.select_ids([row_id for i, row_id in enumerate(member["rowIds"]) if all(math.isfinite(values[i]) and low <= values[i] <= high for values, low, high in channels)])

    def select_bounds(self, layer_id: str, bounds: dict[str, Any]) -> None:
        if not isinstance(bounds, dict) or set(bounds) != {"x", "y"}:
            raise ValueError("Bounds require x/y ranges")
        for interval in bounds.values():
            if not isinstance(interval, (list, tuple)) or len(interval) != 2 or number(interval[0], "bound") > number(interval[1], "bound"):
                raise ValueError("Bounds must be finite ordered pairs")
        with self.figure._lock:
            group = self._current()
            member = next((member for member in group["members"] if member["layerId"] == layer_id), None)
            layer = next((layer for layer in self.figure._spec["layers"] if layer["id"] == layer_id), None)
            if member is None or layer is None:
                raise ValueError("Bounds layer must belong to the observation group")
            from .advanced import KINDS
            if layer["kind"] in KINDS:
                self.select_ids([member["rowIds"][i] for i in _advanced_membership(self.figure,layer,bounds)])
            else:
                self.set_predicate({"layerId": layer_id, "ranges": {"x": bounds["x"], "y": bounds["y"]}})

    def query(self, *, offset: int = 0, limit: int = 1000, revision: str | None = None) -> dict[str, Any]:
        with self.figure._lock:
            group = self._current()
            token = f"{group['generation']}:{group['sequence']}:{self._baseline}"
            if revision is not None and revision != token:
                raise RuntimeError("STALE_OBSERVATIONS: query revision changed")
            if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 10000:
                raise ValueError("offset must be nonnegative and limit from 1 through 10000")
            ids = group.get("selectedIds", group["rowIds"])
            return {"ids": ids[offset:offset+limit], "total": len(ids), "offset": offset, "limit": limit,
                    "nextOffset": offset+limit if offset+limit < len(ids) else None, "revision": token, "active": "selectedIds" in group}

    def _on_selection(self, event: Any) -> None:
        if not isinstance(event, dict) or event.get("mode") == "frozen":
            return
        with self.figure._lock:
            group = self._current()
            member = next((member for member in group["members"] if member["layerId"] == event.get("layerId")), None)
            if member is None:
                return
            if event.get("sourceKind") in ("cell", "window"):
                return
            if event.get("predicate") is not None:
                self.set_predicate(event["predicate"])
            elif "bounds" in event:
                self.select_bounds(event["layerId"], event["bounds"])
            elif "indices" in event and not event.get("truncated", False):
                self.select_ids([member["rowIds"][i] for i in event["indices"] if type(i) is int and 0 <= i < len(member["rowIds"])])

    def clear(self) -> None:
        self._commit(None)

    def dispose(self) -> None:
        if self._disposed:
            return
        self._disposed = True
        self._unsubscribe()
        if not self.figure._closed:
            self.figure.set_observation_groups([item for item in self.figure._spec.get("observationGroups", []) if item["id"] != self.id])

    remove = dispose


def link_observations(figure: Any, *, dataset_id: str, row_ids: Any, members: Any, id: str | None = None) -> ObservationController:
    return ObservationController(figure, dataset_id=dataset_id, row_ids=row_ids, members=members, id=id)
