"""Emit real Python snapshots and wire buffers for cross-language browser tests."""
import base64
import json
import sys
from array import array
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))
import vesora as vs


def fixture(kind, figure):
    snapshot = figure.snapshot()
    buffers = [{"id": source["id"], "base64": base64.b64encode(figure._data_bytes(source["id"], source["version"])).decode("ascii")}
               for source in snapshot["sources"]]
    return {"kind": kind, "snapshot": snapshot, "buffers": buffers}


scatter = vs.figure(title="Shared measurements")
layer = scatter.scatter(array("d", [1, 2, 3]), array("f", [3, 1, 2]), color="#218061", label="Measurements")
scatter.set_axes(xlim=(0, 4), ylim=(0, 4), xlabel="x", ylabel="value")

surface = vs.figure(title="Shared surface")
axis = [-1, 1]
surface.surface(axis, axis, [[0, 1], [2, 3]], colormap="magma")
initial = fixture("scatter", scatter)
layer.set_data(y=array("f", [1, 2, 3]))
layer.set_style(color="#0000ff")
initial["update"] = fixture("scatter", scatter)
result = [initial, fixture("surface", surface)]
scatter.close()
surface.close()
print(json.dumps(result))
