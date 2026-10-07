"""Portable scenes preserve scientific data and never execute supplied text."""
import base64
import importlib
import json
import struct
import subprocess
import sys
import threading
from array import array
from html.parser import HTMLParser
from pathlib import Path

import pytest

import vesora as vs


class PayloadParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inside = False
        self.payload = ""
        self.scripts = 0

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.scripts += 1
            self.inside = dict(attrs).get("id") == "payload"

    def handle_endtag(self, tag):
        if tag == "script":
            self.inside = False

    def handle_data(self, data):
        if self.inside:
            self.payload += data


@pytest.fixture
def template(tmp_path, monkeypatch):
    exporter = importlib.import_module("vesora.html")
    path = tmp_path / "standalone.html"
    path.write_text('<!doctype html><script id="payload" type="application/json">__VESORA_PAYLOAD_JSON__</script>', encoding="utf-8")
    monkeypatch.setattr(exporter, "_TEMPLATE", path)
    return path


def decode(document):
    parser = PayloadParser()
    parser.feed(document)
    assert parser.scripts == 1
    return json.loads(parser.payload)


@pytest.mark.parametrize("code,dtype", [("b", "int8"), ("B", "uint8"), ("h", "int16"), ("H", "uint16"),
                                      ("i", "int32"), ("I", "uint32"), ("f", "float32"), ("d", "float64")])
def test_html_keeps_binary_source_types_and_all_rows(template, code, dtype):
    fig = vs.Figure()
    layer = fig.scatter(array("d", [1e12, 1e12 + 0.125]), array(code, [2, 3]))
    layer.set_visible(False)
    fig.set_axes(xlim=(1e12, 1e12 + 0.25))
    envelope = decode(fig.to_html())
    assert envelope["formatVersion"] == 1
    assert envelope["snapshot"] == fig.snapshot()
    spec = envelope["snapshot"]["figure"]
    assert spec["layers"][0]["visible"] is False
    payloads = {item["id"]: base64.b64decode(item["base64"], validate=True) for item in envelope["buffers"]}
    sources = {source["id"]: source for source in envelope["snapshot"]["sources"]}
    assert set(payloads) == set(sources)
    y_id = spec["layers"][0]["data"]["y"]
    assert sources[y_id]["dtype"] == dtype
    assert payloads[y_id] == struct.pack("<2" + code, 2, 3)
    x_id = spec["layers"][0]["data"]["x"]
    assert payloads[x_id] == struct.pack("<2d", 1e12, 1e12 + 0.125)


def test_html_preserves_nonfinite_binary_data_and_empty_arrays(template):
    fig = vs.Figure()
    fig.plot([float("nan"), float("inf"), -float("inf")])
    fig.plot([])
    envelope = decode(fig.to_html())
    for item, source in zip(envelope["buffers"], envelope["snapshot"]["sources"]):
        assert base64.b64decode(item["base64"]) == fig._data_bytes(source["id"], source["version"])


def test_html_escapes_text_and_writes_without_starting_a_host(template, tmp_path):
    text = '</script><script>alert("x")</script><!--&>\u2028\u2029 İ 🌌'
    fig = vs.Figure(title=text)
    fig.plot([1, 2], label=text)
    fig.set_axes(xlabel=text)
    fig.bookmark(text, note=text)
    document = fig.to_html()
    assert text not in document
    spec = decode(document)["snapshot"]["figure"]
    assert spec["title"] == spec["bookmarks"][0]["note"] == text
    path = tmp_path / "discovery.html"
    assert fig.save_html(path) == path
    assert path.read_text(encoding="utf-8") == document
    assert fig._host is fig._window is fig._widget is None
    with pytest.raises(ValueError, match="HTML"):
        fig.save_html(tmp_path / "wrong.png")


def test_export_snapshot_is_detached_before_serializing(template, monkeypatch):
    exporter = importlib.import_module("vesora.html")
    fig = vs.Figure()
    layer = fig.plot([1, 2])
    old = fig.snapshot()
    original = exporter.make_html

    def serialize(snapshot, buffers):
        updated = threading.Event()

        def update():
            layer.set_data(y=[8, 9, 10], x=[0, 1, 2])
            updated.set()

        thread = threading.Thread(target=update, daemon=True)
        thread.start()
        assert updated.wait(5), "HTML serialization must not hold the figure lock"
        thread.join()
        return original(snapshot, buffers)

    monkeypatch.setattr(exporter, "make_html", serialize)
    envelope = decode(fig.to_html())
    assert envelope["snapshot"] == old
    assert envelope["snapshot"] != fig.snapshot()
    y_id = old["figure"]["layers"][0]["data"]["y"]
    raw = next(item for item in envelope["buffers"] if item["id"] == y_id)
    assert base64.b64decode(raw["base64"]) == struct.pack("<2d", 1, 2)


def test_html_requires_valid_bundled_template(template):
    fig = vs.Figure()
    template.write_text("No payload marker", encoding="utf-8")
    with pytest.raises(RuntimeError, match="placeholder"):
        fig.to_html()
    template.unlink()
    with pytest.raises(RuntimeError, match="missing"):
        fig.to_html()
    fig.close()
    with pytest.raises(RuntimeError, match="closed"):
        fig.to_html()


def test_bookmarks_are_ordered_copies_and_restore_only_the_view():
    fig = vs.Figure()
    layer = fig.plot([1, 2])
    initial = fig.snapshot()["figure"]["view"]
    assert fig.bookmark("  Overview  ") is fig
    fig.set_axes(xlim=(1, 4), xscale="log", xlabel="Zoom")
    fig.bookmark("Detail", note="A narrow peak")
    fig.set_axes(ylim=(2, 5))
    fig.bookmark("Detail", note="Updated note")
    layer.set_visible(False)
    layer.set_data(y=[7, 8])
    before = fig.snapshot()
    bookmarks = before["figure"]["bookmarks"]
    assert [item["name"] for item in bookmarks] == ["Overview", "Detail"]
    assert bookmarks[1]["note"] == "Updated note"
    assert fig.restore_bookmark(" Overview ") is fig
    after = fig.snapshot()
    assert after["figure"]["view"] == initial
    assert after["figure"]["layers"] == before["figure"]["layers"]
    assert after["sources"] == before["sources"]
    assert "xDomain" not in after["figure"]["view"]
    fig.restore_bookmark("Detail")
    fig.set_axes(xlabel="Changed after restore")
    assert fig.snapshot()["figure"]["bookmarks"][1]["view"]["xLabel"] == "Zoom"
    assert fig.remove_bookmark(" Overview ") is fig
    assert [item["name"] for item in fig.snapshot()["figure"]["bookmarks"]] == ["Detail"]


def test_3d_bookmark_keeps_camera_pan_and_viewchange_clears_domains_without_echo():
    fig = vs.Figure(kind="3d")
    fig.scatter3d([1, 2], [2, 3], [3, 4])
    camera = {"azimuth": 80, "elevation": 40, "distance": 2}
    published = []
    fig._listeners.append(lambda: published.append(True))
    fig._emit("viewchange", {"camera": camera, "pan3d": [0.3, -0.2], "xDomain": [1, 2]})
    assert published == []
    fig.bookmark("Side")
    fig._emit("viewchange", {"pan3d": [0, 0], "xDomain": None, "yDomain": None, "zDomain": None})
    assert "xDomain" not in fig.snapshot()["figure"]["view"]
    fig.restore_bookmark("Side")
    view = fig.snapshot()["figure"]["view"]
    assert view["camera"] == camera and view["pan3d"] == [0.3, -0.2]
    assert view["xDomain"] == [1, 2]


@pytest.mark.parametrize("bad", [None, [], [0], [0, 1, 2], [0, float("inf")], [True, 0], ["0", 1]])
def test_invalid_pan_is_rejected_atomically(bad):
    fig = vs.Figure()
    before = fig.snapshot()
    with pytest.raises(ValueError, match="finite"):
        fig._emit("viewchange", {"pan3d": bad})
    assert fig.snapshot() == before


def test_invalid_and_missing_bookmarks_leave_state_unchanged():
    fig = vs.Figure()
    before = fig.snapshot()
    for method in (fig.bookmark, fig.restore_bookmark, fig.remove_bookmark):
        with pytest.raises(ValueError, match="empty"):
            method("  ")
        with pytest.raises(TypeError, match="string"):
            method(10)
    with pytest.raises(TypeError, match="note"):
        fig.bookmark("Name", note=None)
    for method in (fig.restore_bookmark, fig.remove_bookmark):
        with pytest.raises(ValueError, match="Unknown"):
            method("Missing")
    assert fig.snapshot() == before
    fig.close()
    for method in (fig.bookmark, fig.restore_bookmark, fig.remove_bookmark):
        with pytest.raises(RuntimeError, match="closed"):
            method("Name")


def test_empty_figure_bookmark_prevents_incompatible_dimension_change():
    fig = vs.Figure()
    fig.bookmark("Empty 2D view")
    before = fig.snapshot()
    with pytest.raises(ValueError, match="separate figures"):
        fig.scatter3d([1], [2], [3])
    assert fig.snapshot() == before
    fig.remove_bookmark("Empty 2D view")
    assert "bookmarks" not in fig.snapshot()["figure"]
    fig.scatter3d([1], [2], [3])


def test_html_export_without_qt_server_numpy_or_site_packages(template):
    code = r'''
import importlib.abc
import pathlib
import sys

class BlockHosts(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".")[0] in {"numpy", "PySide6", "aiohttp", "anywidget"} or fullname in {"vesora.qt", "vesora.host", "vesora.notebook"}:
            raise AssertionError("HTML export must not import " + fullname)

sys.meta_path.insert(0, BlockHosts())
sys.path.insert(0, sys.argv[1])
import vesora as vs
from vesora import html
html._TEMPLATE = pathlib.Path(sys.argv[2])
fig = vs.Figure()
fig.plot([1, 2, 3])
fig.bookmark("Overview")
document = fig.to_html()
assert '"formatVersion":1' in document
assert "__VESORA_PAYLOAD_JSON__" not in document
assert fig._host is fig._window is fig._widget is None
'''
    source = Path(__file__).resolve().parents[2] / "python"
    result = subprocess.run([sys.executable, "-S", "-c", code, str(source), str(template)],
                            text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
