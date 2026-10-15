"""Shared accounting for actual Qt/Jupyter hosts; never substitutes a renderer."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import os
import platform
import struct
import sys
import time
import zipfile
from array import array
from collections import deque
from pathlib import Path

import vesora as vs


def setting(name, default, minimum, maximum, *, integer=False):
    raw = os.environ.get(name, str(default))
    value = int(raw) if integer else float(raw)
    if not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


class Histogram:
    """Bounded logarithmic buckets; percentiles are explicit upper bounds."""
    def __init__(self):
        self.buckets = [0] * 256
        self.count = 0
        self.total = self.maximum = 0.0

    def add(self, milliseconds):
        index = min(255, max(0, math.ceil(math.log2(max(.001, milliseconds) / .001) * 8)))
        self.buckets[index] += 1
        self.count += 1
        self.total += milliseconds
        self.maximum = max(self.maximum, milliseconds)

    def result(self):
        def percentile(fraction):
            seen, target = 0, math.ceil(self.count * fraction)
            for index, count in enumerate(self.buckets):
                seen += count
                if target and seen >= target:
                    return .001 * 2 ** (index / 8)
            return None
        return {"count": self.count, "mean_ms": self.total / self.count if self.count else None,
                "max_ms": self.maximum if self.count else None,
                "p50_upper_ms": percentile(.5), "p95_upper_ms": percentile(.95), "p99_upper_ms": percentile(.99),
                "quantile_method": "log2 histogram, eight buckets per doubling; reported percentiles are bucket upper bounds"}


def provenance():
    module = Path(vs.__file__).resolve()
    installed = os.environ.get("VESORA_INSTALLED_PACKAGE") == "1"
    if installed and "site-packages" not in module.parts:
        raise AssertionError(f"Installed soak imported checkout source: {module}")
    wheel = os.environ.get("VESORA_SOAK_WHEEL")
    evidence = {"vesora_version": vs.__version__, "module": str(module), "installed_package": installed,
                "python": sys.version, "platform": platform.platform(), "profile": os.environ.get("VESORA_SOAK_PROFILE", "isolated")}
    assert evidence["profile"] in ("isolated", "concurrent-stress")
    evidence["latency_reference"] = evidence["profile"] == "isolated"
    if wheel:
        if not installed:
            raise AssertionError("VESORA_SOAK_WHEEL requires VESORA_INSTALLED_PACKAGE=1")
        path = Path(wheel).resolve()
        with zipfile.ZipFile(path) as archive:
            members = [name for name in archive.namelist() if name.startswith("vesora/") and not name.endswith("/")]
            assert members, "Wheel contains no vesora files"
            for name in members:
                actual = module.parent.parent / name
                assert actual.read_bytes() == archive.read(name), f"Installed file differs from exact wheel: {name}"
        evidence.update(wheel=str(path), wheel_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), verified_wheel_members=len(members))
    for name in ("PySide6", "aiohttp", "anywidget", "jupyterlab", "ipykernel"):
        try:
            evidence[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            evidence[name] = None
    return evidence


def resident_bytes():
    # This counter belongs to the Python process only, not WebEngine subprocesses.
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        process = ctypes.windll.kernel32.GetCurrentProcess
        process.restype = wintypes.HANDLE
        query = ctypes.windll.psapi.GetProcessMemoryInfo
        query.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        return int(counters.WorkingSetSize) if query(process(), ctypes.byref(counters), counters.cb) else None
    return None


class Workload:
    def __init__(self, host, output):
        self.host_kind = host
        self.output = Path(output).resolve()
        self.output.mkdir(parents=True, exist_ok=True)
        if (self.output / "progress.json").exists():
            raise ValueError("Choose a fresh soak output directory; existing evidence must not be mixed or overwritten")
        self.duration = setting("VESORA_SOAK_SECONDS", 7200, 5, 86400)
        self.retention = setting("VESORA_SOAK_RETENTION", 100000, 10, 1000000, integer=True)
        self.batch = setting("VESORA_SOAK_BATCH", 100, 1, 10000, integer=True)
        self.hz = setting("VESORA_SOAK_HZ", 20, .1, 200)
        self.freeze_every = setting("VESORA_SOAK_FREEZE_EVERY", min(300, self.duration / 3), 1, 7200)
        self.freeze_hold = setting("VESORA_SOAK_FREEZE_HOLD", min(10, self.duration / 10), .2, 120)
        if self.freeze_every + self.freeze_hold >= self.duration:
            raise ValueError("Soak duration must leave time for at least one freeze, ingestion and resume cycle")
        self.evidence = provenance()
        self.figure = vs.figure(title=f"Vesora v0.9 {host} soak", width=1000, height=500)
        self.curves = [self.figure.plot(array("d", range(self.retention)), array("d", (self.value(i, series) for i in range(self.retention))),
                                       label=f"Channel {series}").enable_streaming(max_points=self.retention) for series in range(3)]
        self.errors = []
        self.figure.on("error", lambda event: self.errors.append(str(event)))
        self.next_sequence = self.retention
        self.batches = self.rows = self.bursts = 0
        self.accepted = Histogram()
        self.presented_live = Histogram()
        self.presented_across_freeze = Histogram()
        self.pending_accept = deque()
        self.pending_frame = deque()
        self.samples = []
        self.maxima = {"pending_bytes": 0, "pending_records": 0, "inflight_views": 0, "pending_frame_batches": 0, "source_bytes": 0}
        self.freeze_epoch = 0
        self.was_frozen = False
        self.started = None
        self.stopped = None
        self.next_due = self.next_sample = self.next_progress = 0
        self.frame_observations = 0
        self.last_frame = None
        self.status = "initializing"
        self.progress_write_contentions = 0

    @staticmethod
    def value(index, series):
        return math.sin(index * .01) + series

    @property
    def host(self):
        return self.figure._widget if self.host_kind == "jupyter" else self.figure._host

    @property
    def revision(self):
        return self.host.revision if self.host_kind == "jupyter" else self.host._revision

    def queues(self):
        with self.figure._lock:
            return [{"acknowledged": q.acknowledged, "presented": q.presented_revision, "frame": dict(q.frame) if q.frame else None,
                     "pending_bytes": q.pending_bytes, "pending_records": q.pending_records, "inflight": q.inflight is not None,
                     "needs_snapshot": q.needs_snapshot, "transport_version": q.transport_version} for q in list(self.host._views.values())]

    def begin(self):
        queues = self.queues()
        assert queues and all(q["transport_version"] == 3 for q in queues), "Soak requires real negotiated v3 views"
        self.started = self.next_due = self.next_sample = self.next_progress = time.perf_counter()
        self.status = "producing"
        self.write_progress()

    @property
    def elapsed(self):
        return 0 if self.started is None else time.perf_counter() - self.started

    def tick(self):
        now = time.perf_counter()
        self.collect(now)
        if self.stopped is not None:
            return False
        if now - self.started >= self.duration:
            self.stopped = now
            self.status = "draining"
            self.write_progress()
            return False
        if now < self.next_due:
            return True
        count = self.batch * (10 if self.batches and self.batches % 100 == 0 else 1)
        if count > self.batch:
            self.bursts += 1
        indices = range(self.next_sequence, self.next_sequence + count)
        before = self.revision
        self.figure.append_data_batch([(layer, {"x": array("d", indices), "y": array("d", (self.value(i, series) for i in indices))})
                                       for series, layer in enumerate(self.curves)])
        revision = self.revision
        assert revision == before + 1, "An atomic three-series batch must publish exactly one host revision"
        self.next_sequence += count
        self.batches += 1
        self.rows += count
        self.pending_accept.append((revision, now))
        self.pending_frame.append((revision, now, self.freeze_epoch, self.was_frozen))
        assert len(self.pending_frame) <= 20000, "Renderer failed to cover the bounded pending revision ledger"
        self.next_due = max(self.next_due + 1 / self.hz, time.perf_counter())
        return True

    def collect(self, now=None):
        now = time.perf_counter() if now is None else now
        queues = self.queues()
        frozen = any(q["frame"] and q["frame"]["mode"] == "frozen" for q in queues)
        if frozen and not self.was_frozen:
            self.freeze_epoch += 1
        self.was_frozen = frozen
        ack = min((q["acknowledged"] if q["acknowledged"] is not None else -1 for q in queues), default=-1)
        frame = min((q["presented"] if q["presented"] is not None else -1 for q in queues), default=-1)
        while self.pending_accept and self.pending_accept[0][0] <= ack:
            _, started = self.pending_accept.popleft()
            self.accepted.add((now - started) * 1000)
        while self.pending_frame and self.pending_frame[0][0] <= frame:
            _, started, epoch, began_frozen = self.pending_frame.popleft()
            target = self.presented_across_freeze if began_frozen or epoch != self.freeze_epoch else self.presented_live
            target.add((now - started) * 1000)
        identity = tuple((q["frame"]["frameId"], q["frame"]["revision"], q["frame"]["mode"]) if q["frame"] else None for q in queues)
        if identity != self.last_frame:
            self.frame_observations += 1
            self.last_frame = identity
        current = {"pending_bytes": sum(q["pending_bytes"] for q in queues), "pending_records": sum(q["pending_records"] for q in queues),
                   "inflight_views": sum(q["inflight"] for q in queues), "pending_frame_batches": len(self.pending_frame),
                   "source_bytes": sum(item[0]["byteLength"] for item in self.figure._sources.values())}
        for name, value in current.items():
            self.maxima[name] = max(self.maxima[name], value)
        assert current["source_bytes"] <= 3 * 2 * self.retention * 8
        assert all(q["pending_bytes"] <= 8 * 1024 * 1024 and q["pending_records"] <= 1024 for q in queues)
        assert not self.errors, self.errors[-3:]
        if self.started is not None and now >= self.next_sample:
            self.samples.append({"elapsed_seconds": now - self.started, "python_resident_bytes": resident_bytes(), **current, "queues": queues})
            self.next_sample = now + 5
        if self.started is not None and now >= self.next_progress:
            self.next_progress = now + 1
            self.write_progress()

    def drained(self):
        self.collect()
        queues = self.queues()
        return bool(queues) and not self.pending_accept and not self.pending_frame and all(
            q["acknowledged"] == self.revision and q["presented"] == self.revision and not q["inflight"] and
            not q["pending_records"] and not q["pending_bytes"] and not q["needs_snapshot"] for q in queues)

    def verify_sources(self):
        for series, curve in enumerate(self.curves):
            state = self.figure._streams[curve.id]
            assert state["nextSequence"] == self.next_sequence and state["retained"] == self.retention
            assert state["evicted"] == self.rows
            data = self.figure._layer_arrays(curve._spec())
            assert len(data["x"]) == len(data["y"]) == self.retention
            for offset, (x, y) in enumerate(zip(data["x"], data["y"])):
                expected = self.next_sequence - self.retention + offset
                assert x == expected and y == self.value(expected, series)

    def write_progress(self):
        payload = {"status": self.status, "elapsed_seconds": self.elapsed, "requested_seconds": self.duration,
                   "batches": self.batches, "next_sequence": self.next_sequence, "revision": self.revision,
                   "frozen": self.was_frozen, "pending_accept_batches": len(self.pending_accept), "pending_frame_batches": len(self.pending_frame),
                   "queues": self.queues(), "errors": self.errors[-3:]}
        temporary = self.output / "progress.tmp.json"
        try:
            temporary.write_text(json.dumps(payload), encoding="utf-8")
            temporary.replace(self.output / "progress.json")
        except PermissionError:
            # A Windows file reader/scanner can briefly deny replacement. This
            # observer file must not stop the actual producer; retry next tick.
            self.progress_write_contentions += 1

    def finish(self):
        assert self.stopped is not None and self.drained(), "The final live frame and transport queues must drain"
        self.verify_sources()
        assert self.accepted.count == self.batches
        assert self.presented_live.count + self.presented_across_freeze.count == self.batches
        self.status = "passed"
        self.write_progress()
        return {"status": "passed", "host": self.host_kind, "evidence": self.evidence,
                "requested_seconds": self.duration, "actual_producer_seconds": self.stopped - self.started, "actual_total_seconds": self.elapsed,
                "two_hour_duration_met": self.stopped - self.started >= 7200, "exact_wheel_verified": bool(self.evidence.get("verified_wheel_members")),
                "series": 3, "retention_per_series": self.retention, "base_batch_rows": self.batch, "requested_hz": self.hz,
                "observed_batches_per_second": self.batches / (self.stopped - self.started),
                "accepted_batches": self.batches, "rows_per_series": self.rows, "next_sequence": self.next_sequence, "burst_batches": self.bursts,
                "acceptance_latency": self.accepted.result(), "live_presentation_latency": self.presented_live.result(),
                "presentation_across_freeze_latency": self.presented_across_freeze.result(), "observed_frame_changes": self.frame_observations,
                "maxima": self.maxima, "samples": self.samples, "final_queues": self.queues(), "errors": self.errors,
                "progress_write_contentions": self.progress_write_contentions,
                "measurement_scope": "Python append invocation to all real views' acceptance or completed live-frame notification, sampled by the host event loop. Coalesced batches are covered by later frames; frozen waits are reported separately. Python RSS excludes browser/WebEngine processes; GPU/raster/worker bytes are not inferred from RSS."}


def validate_displayed_html(html, expected_snapshot_id=None):
    import base64
    import re
    payload = json.loads(re.search(r'<script[^>]*id="vesora-payload"[^>]*>(.*?)</script>', html, re.S).group(1))
    assert payload["capture"]["source"] == "displayed"
    if expected_snapshot_id is not None:
        assert payload["capture"]["snapshotId"] == expected_snapshot_id
    sources = {item["id"]: item for item in payload["snapshot"]["sources"]}
    buffers = {item["id"]: base64.b64decode(item["base64"], validate=True) for item in payload["buffers"]}
    ranges = []
    for series, layer in enumerate(payload["snapshot"]["figure"]["layers"]):
        decoded = {}
        for role in ("x", "y"):
            descriptor = sources[layer["data"][role]]
            assert descriptor["dtype"] == "float64"
            decoded[role] = array("d")
            decoded[role].frombytes(buffers[descriptor["id"]])
            if sys.byteorder != "little":
                decoded[role].byteswap()
            assert len(decoded[role]) == descriptor["shape"][0]
        x, y = decoded["x"], decoded["y"]
        assert len(x) == len(y) and len(x) > 0
        for offset in range(len(x)):
            assert abs(y[offset] - Workload.value(x[offset], series)) < 1e-12
        assert all(x[index] == x[0] + index for index in range(len(x)))
        ranges.append([x[0], x[-1], len(x)])
    assert len(ranges) == 3 and all(value == ranges[0] for value in ranges)
    return {"capture": payload["capture"], "retained_range": ranges[0], "sha256": hashlib.sha256(html.encode()).hexdigest()}


def validate_png(path):
    payload = Path(path).read_bytes()
    assert payload[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", payload[16:24])
    assert width > 0 and height > 0
    return {"path": str(path), "sha256": hashlib.sha256(payload).hexdigest(), "width": width, "height": height}
