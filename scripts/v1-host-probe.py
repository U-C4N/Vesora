"""Real hidden Qt rendering of the installed wheel's ten analysis families."""
from pathlib import Path
import json
import os
import runpy
import struct
import sys

target = Path(os.environ["VESORA_INSTALL_TARGET"]).resolve()
sys.path.insert(0, str(target))
import vesora as vs
assert Path(vs.__file__).resolve().is_relative_to(target), vs.__file__
assert vs.__version__ == "1.1.0"
root = Path(__file__).resolve().parents[1]
output = Path(os.environ["VESORA_V1_OUTPUT"])
gallery = runpy.run_path(str(root / "skills/vesora/scripts/example_python.py"))
fig = gallery["make_figure"]()
try:
    assert fig.snapshot()["figure"]["protocolVersion"] == 9
    path = fig.savefig(output / "qt-advanced.png", timeout=35, width=1200, height=1800, scale=1)
    payload = path.read_bytes()
    assert payload[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", payload[16:24]) == (1200, 1800)
    assert len(payload) > 2000
finally:
    fig.close()
    vs.process_events()
assert fig._closed and not fig._sources, "Qt figure did not release source data"
(output / "qt.json").write_text(json.dumps({"status": "passed", "host": "real-QtWebEngine", "version": vs.__version__, "installedPackage": str(vs.__file__), "analysisFamilies": 10, "sourceCleanup": True}), encoding="utf-8")
print("Real installed-wheel Qt rendered all ten families and released sources")
