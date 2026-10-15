"""Executed by the real Jupyter kernel; the browser owns inspection controls."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import time
from pathlib import Path


async def start(output):
    location = Path(__file__).with_name("host_workload.py")
    spec = importlib.util.spec_from_file_location("vesora_soak_workload", location)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    workload = helper.Workload("jupyter", output)
    workload.figure.show()
    await workload.figure.savefig_async(workload.output / "initial.png", width=1000, height=500, scale=1, timeout=60)
    deadline = time.perf_counter() + 60
    while not workload.drained():
        assert time.perf_counter() < deadline, "Initial Jupyter frame was never presented"
        await asyncio.sleep(.01)
    workload.begin()

    async def produce():
        report = {"status": "failed", "host": "jupyter", "evidence": workload.evidence}
        try:
            while workload.tick():
                await asyncio.sleep(.005)
            deadline = time.perf_counter() + 90
            while not workload.drained():
                assert time.perf_counter() < deadline, "Final Jupyter live-frame/transport drain timed out"
                await asyncio.sleep(.01)
            report = workload.finish()
            widget = workload.figure._widget
            assert not widget._export_requests
            report["final_widget_exports"] = len(widget._export_requests)
            report["reconnect"] = "Not exercised: the fixture has no supported stable-session browser-comm reconnect control; Qt tests actual reconnect."
        except BaseException as error:
            report.update(status="failed", error=repr(error), actual_total_seconds=workload.elapsed, samples=workload.samples)
            workload.status = "failed"
            workload.errors.append(repr(error))
            workload.write_progress()
            raise
        finally:
            (workload.output / "jupyter-producer.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        return report

    return workload, asyncio.create_task(produce())


async def finish(workload, task):
    report = {"status": "failed", "host": "jupyter"}
    widget = workload.figure._widget
    try:
        report = await task
        assert report["status"] == "passed"
    finally:
        workload.figure.close()
        cleanup = {"source_count": len(workload.figure._sources), "listener_count": len(workload.figure._listeners),
                   "widget_views": len(widget._views), "widget_exports": len(widget._export_requests),
                   "transfer_timer": widget._transfer_timer is not None}
        report["cleanup"] = cleanup
        if any(cleanup.values()):
            report["status"] = "failed"
        (workload.output / "jupyter-producer.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    assert not any(cleanup.values()), cleanup
    return report


def validate_exports(directory):
    location = Path(__file__).with_name("host_workload.py")
    spec = importlib.util.spec_from_file_location("vesora_soak_workload", location)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    outputs = []
    for path in sorted(Path(directory).glob("frozen-*.html")):
        entry = helper.validate_displayed_html(path.read_text(encoding="utf-8"))
        assert entry["capture"].get("snapshotId")
        entry["png"] = helper.validate_png(path.with_suffix(".png"))
        outputs.append(entry)
    assert outputs, "No displayed frozen exports were produced"
    return outputs


def validate_final(workload):
    location = Path(__file__).with_name("host_workload.py")
    spec = importlib.util.spec_from_file_location("vesora_soak_workload", location)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    result = helper.validate_displayed_html((workload.output / "final-displayed.html").read_text(encoding="utf-8"))
    assert result["retained_range"] == [workload.next_sequence - workload.retention, workload.next_sequence - 1, workload.retention]
    return result
