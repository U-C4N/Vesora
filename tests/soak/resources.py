"""Read-only machine and owned process-tree samples for the soak controller."""
import argparse
import ctypes
import datetime
import json
import os
import time

import psutil


def sample(root_pid=None):
    result = {
        "at": datetime.datetime.now(datetime.UTC).isoformat(),
        "availableMemoryBytes": psutil.virtual_memory().available,
        "totalMemoryBytes": psutil.virtual_memory().total,
        "diskFreeBytes": psutil.disk_usage(os.getcwd()).free,
        "monotonicSeconds": time.monotonic(),
        "cpuPercent": psutil.cpu_percent(interval=1),
        "processes": [],
        "scope": "Sum of owned process working sets; shared pages may be counted more than once. Not GPU memory.",
    }
    if os.name == "nt":
        # Unlike monotonic uptime, this counter excludes suspended/hibernated time.
        awake = ctypes.c_ulonglong()
        query = ctypes.windll.kernel32.QueryUnbiasedInterruptTime
        query.argtypes = [ctypes.POINTER(ctypes.c_ulonglong)]
        query.restype = ctypes.c_bool
        if not query(ctypes.byref(awake)):
            raise ctypes.WinError()
        result["awakeSeconds"] = awake.value / 10_000_000
    if root_pid is not None:
        try:
            root = psutil.Process(root_pid)
            members = [root, *root.children(recursive=True)]
        except psutil.NoSuchProcess:
            members = []
        for process in members:
            try:
                result["processes"].append({"pid": process.pid, "name": process.name(), "rss": process.memory_info().rss})
            except psutil.NoSuchProcess:
                pass
        result["ownedRssSumBytes"] = sum(item["rss"] for item in result["processes"])
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int)
    args = parser.parse_args()
    print(json.dumps(sample(args.pid)))
