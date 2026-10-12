"""Opt-in real Qt input, loopback callbacks, selected PNG and offline retention."""
import base64
import json
import os
import time
from html.parser import HTMLParser

import pytest

import vesora as vs

pytestmark = pytest.mark.skipif(os.environ.get("VESORA_TEST_QT") != "1",
                              reason="Set VESORA_TEST_QT=1 to run the real hidden Qt viewer")


def wait_for(predicate, *, timeout=30):
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() >= deadline:
            raise AssertionError("Timed out waiting for the real Qt viewer interaction")
        vs.process_events()
        time.sleep(.005)


def javascript(page, script):
    results = []
    page.runJavaScript(script, results.append)
    wait_for(lambda: bool(results))
    return results[0]


class PayloadParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inside = False
        self.payload = ""

    def handle_starttag(self, tag, attrs):
        self.inside = tag == "script" and dict(attrs).get("id") == "vesora-payload"

    def handle_endtag(self, tag):
        if tag == "script":
            self.inside = False

    def handle_data(self, data):
        if self.inside:
            self.payload += data


def test_real_qt_shift_drag_retains_cohort_exports_labels_and_python_clear(tmp_path):
    pytest.importorskip("PySide6")
    from PySide6.QtCore import QPoint, Qt
    from PySide6.QtGui import QImage
    from PySide6.QtTest import QTest

    fig = vs.subplots(1, 3, title="Real Qt linked cohort", width=1200, height=620)
    a = fig.panel(0, 0).scatter([1, 2, 3, 8], [1, 2, 3, 8], size=18, color="#38bdf8")
    b = fig.panel(0, 1).scatter([8, 3, 2, 1], [1, 2, 3, 8], size=18, color="#38bdf8")
    h = fig.panel(0, 2).hist([1, 2, 3, 8], bins=[0, 2, 4, 10], color="#38bdf8")
    for col in range(2):
        fig.panel(0, col).set_axes(xlim=(0, 10), ylim=(0, 10))
    link = fig.link_selection(scatter=[a, b], histogram=h)
    original_sources = fig.snapshot()["sources"]
    events = []
    fig.on("selection", lambda event: events.append((event, fig.snapshot()["figure"]["selectionLink"].get("selection"))))
    try:
        initial = fig.savefig(tmp_path / "linked-initial.png", timeout=45).read_bytes()
        view = fig._window._vesora_view
        page = view.page()
        javascript(page, """(() => {
          window.__vesoraTestText = [];
          const original = CanvasRenderingContext2D.prototype.fillText;
          CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
            window.__vesoraTestText.push(String(text)); return original.call(this, text, ...args);
          };
          return true;
        })()""")
        geometry = json.loads(javascript(page, """JSON.stringify((() => {
          const box = document.querySelector('.vesora-figure canvas:last-of-type').getBoundingClientRect();
          return {x:box.x,y:box.y,width:box.width,height:box.height};
        })())"""))
        # The first numeric panel has fixed [0,10] domains. The rectangle covers
        # observations 1 and 2 (values 2 and 3), excluding values 1 and 8.
        plot_width = geometry["width"] / 3 - 155
        plot_height = geometry["height"] - 70 - 28 - 82 - 36
        start = QPoint(round(geometry["x"] + 70 + .15 * plot_width),
                       round(geometry["y"] + 98 + .85 * plot_height))
        end = QPoint(round(geometry["x"] + 70 + .35 * plot_width),
                     round(geometry["y"] + 98 + .65 * plot_height))
        target = view.focusProxy() or view
        target.setFocus()
        start, end = target.mapFrom(view, start), target.mapFrom(view, end)
        revision = fig._host._revision
        QTest.keyPress(target, Qt.Key.Key_Shift)
        QTest.mousePress(target, Qt.MouseButton.LeftButton, Qt.KeyboardModifier.ShiftModifier, start)
        for step in range(1, 6):
            position = QPoint(round(start.x() + (end.x() - start.x()) * step / 5),
                              round(start.y() + (end.y() - start.y()) * step / 5))
            QTest.mouseMove(target, position, delay=25)
        QTest.mouseRelease(target, Qt.MouseButton.LeftButton, Qt.KeyboardModifier.ShiftModifier, end)
        QTest.keyRelease(target, Qt.Key.Key_Shift)
        wait_for(lambda: any(event[0].get("active") for event in events))
        selected, callback_selection = next(event for event in reversed(events) if event[0].get("active"))
        assert selected["kind"] == "linked" and selected["indices"] == [1, 2]
        assert (selected["count"], selected["total"], selected["fraction"]) == (2, 4, .5)
        assert selected["layerId"] == a.id and selected["panelId"] == "main"
        assert callback_selection == fig.snapshot()["figure"]["selectionLink"]["selection"]
        assert callback_selection["originLayerId"] == a.id
        assert fig._host._revision == revision, "Browser selection must not echo another snapshot"
        assert fig.snapshot()["sources"] == original_sources
        assert javascript(page, "document.querySelector('.vesora-selection-summary').textContent") == "Selected 2 / 4 (50.00%)"
        selected_path = fig.savefig(tmp_path / "linked-selected.png", timeout=45)
        assert selected_path.read_bytes() != initial
        texts = json.loads(javascript(page, "JSON.stringify(window.__vesoraTestText)"))
        assert "Selected 2 / 4 (50.00%)" in texts
        image = QImage(str(selected_path)).convertToFormat(QImage.Format.Format_RGBA8888)
        pixels = memoryview(image.constBits()).cast("B")
        highlights = [0, 0, 0]
        header_ink = 0
        scale = image.width() / geometry["width"]
        for row in range(image.height()):
            for col in range(image.width()):
                offset = row * image.bytesPerLine() + col * 4
                red, green, blue, alpha = pixels[offset:offset + 4]
                if red > 190 and 40 < green < 150 and blue < 70 and alpha > 180:
                    highlights[min(2, col * 3 // image.width())] += 1
                if 70 * scale <= col < 400 * scale and 40 * scale <= row < 57 * scale and max(red, green, blue) < 150 and alpha > 180:
                    header_ink += 1
        assert all(count > 40 for count in highlights), "Both scatter cohorts and selected histogram must render"
        assert header_ink > 40, "The exported n/% header must contain actual text pixels"
        html_path = fig.save_html(tmp_path / "linked-selected.html")
        parser = PayloadParser()
        parser.feed(html_path.read_text(encoding="utf-8"))
        exported = json.loads(parser.payload)
        assert exported["snapshot"] == fig.snapshot()
        assert exported["snapshot"]["figure"]["selectionLink"]["selection"] == callback_selection
        for source, data in zip(exported["snapshot"]["sources"], exported["buffers"]):
            assert base64.b64decode(data["base64"]) == fig._data_bytes(source["id"], source["version"])
        link.clear()
        clear_sequence = fig.snapshot()["figure"]["selectionLink"]["sequence"]
        cleared_path = fig.savefig(tmp_path / "linked-cleared.png", timeout=45)
        wait_for(lambda: any(event[0].get("sequence") == clear_sequence and not event[0].get("active") for event in events))
        cleared = next(event[0] for event in reversed(events) if event[0].get("sequence") == clear_sequence)
        assert cleared["count"] == 0 and cleared["indices"] == [] and cleared["fraction"] == 0
        assert "selection" not in fig.snapshot()["figure"]["selectionLink"]
        assert javascript(page, "document.querySelector('.vesora-clear-selection').disabled") is True
        assert cleared_path.read_bytes() != selected_path.read_bytes()
    finally:
        fig.close()
        vs.process_events()
