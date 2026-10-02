"""Keep plain Python usage working even without third-party packages installed."""
from pathlib import Path
import subprocess
import sys


def test_all_plot_types_without_site_packages():
    source = Path(__file__).resolve().parents[2] / "python"
    code = r'''
from array import array
import importlib.abc
import sys

class NoNumPy(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "numpy" or fullname.startswith("numpy."):
            raise AssertionError("Vesora must not import NumPy")

sys.meta_path.insert(0, NoNumPy())
sys.path.insert(0, sys.argv[1])
import vesora as vs

fig = vs.figure()
line = vs.plot([1, 2, 3])
vs.scatter(array("d", [0, 1]), memoryview(array("f", [2, 3])))
vs.heatmap([[1, 2], [3, 4]])
three_d = vs.figure()
vs.surface([-1, 1], [-1, 1], [[0, 1], [2, 3]])
vs.scatter3d([0, 1], [1, 2], [2, 3])
line.set_data(y=[3, 2, 1])
for target, count in ((fig, 3), (three_d, 2)):
    snapshot = target.snapshot()
    assert len(snapshot["figure"]["layers"]) == count
    for source in snapshot["sources"]:
        assert len(target._data_bytes(source["id"], source["version"])) == source["byteLength"]
    target.close()
    assert target._closed
assert "numpy" not in sys.modules
'''
    result = subprocess.run(
        [sys.executable, "-S", "-c", code, str(source)],
        text=True, capture_output=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
