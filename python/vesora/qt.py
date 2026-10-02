"""Qt desktop host for the same bundled JavaScript viewer used on the web."""
from __future__ import annotations

from pathlib import Path
import threading
import time
from typing import Any

_app: Any = None


def _application() -> Any:
    global _app
    if threading.current_thread() is not threading.main_thread():
        raise RuntimeError("Desktop show/savefig must be called from the Python main thread")
    try:
        from PySide6.QtWidgets import QApplication
    except ImportError as exc:
        raise RuntimeError("The desktop host requires PySide6; install the full vesora package") from exc
    _app = QApplication.instance()
    if _app is None:
        _app = QApplication([])
        _app.setQuitOnLastWindowClosed(False)
    return _app


def _ensure_window(figure: Any, *, visible: bool) -> Any:
    _application()
    from PySide6.QtCore import QUrl, Qt
    from PySide6.QtWidgets import QMainWindow
    from PySide6.QtWebEngineWidgets import QWebEngineView
    from .host import LocalHost
    if figure._window is None:
        figure._host = LocalHost(figure).start()
        class Window(QMainWindow):
            def closeEvent(self, event: Any) -> None:
                super().closeEvent(event)
                host = figure._host
                figure._window = None
                figure._host = None
                if host is not None:
                    host.close()
                figure._emit("windowclose", None)
        window = Window()
        window.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        window.setWindowTitle(figure._spec["title"] or "Vesora")
        window.resize(figure._spec["width"], figure._spec["height"])
        view = QWebEngineView(window)
        window.setCentralWidget(view)
        window._vesora_view = view
        figure._window = window
        view.load(QUrl(figure._host.url))
        if not visible:
            window.setAttribute(Qt.WidgetAttribute.WA_DontShowOnScreen, True)
            window.show()
    if visible:
        if figure._window.testAttribute(Qt.WidgetAttribute.WA_DontShowOnScreen):
            figure._window.hide()
            figure._window.setAttribute(Qt.WidgetAttribute.WA_DontShowOnScreen, False)
        figure._window.show()
        figure._window.raise_()
    return figure._window


def show_figure(figure: Any, *, block: bool) -> Any:
    _ensure_window(figure, visible=True)
    if block:
        from PySide6.QtCore import QEventLoop, QTimer
        loop = QEventLoop()
        timer = QTimer()
        timer.setInterval(25)
        timer.timeout.connect(lambda: loop.quit() if figure._closed or figure._window is None else None)
        timer.start()
        try:
            loop.exec()
        except KeyboardInterrupt:
            figure.close()
        finally:
            timer.stop()
    return figure


def process_events() -> None:
    _application().processEvents()


def save_figure(figure: Any, path: Path, *, timeout: float) -> Path:
    if timeout <= 0:
        raise ValueError("timeout must be positive")
    _ensure_window(figure, visible=False)
    host = figure._host
    deadline = time.monotonic() + timeout
    while not host.ready.is_set():
        if figure._closed or figure._host is not host:
            raise RuntimeError("Viewer closed before export")
        if host.render_error is not None:
            raise host.render_error
        if time.monotonic() >= deadline:
            raise TimeoutError("Viewer did not become ready for PNG export")
        process_events()
        time.sleep(0.005)
    future = host.export()
    while not future.done():
        if time.monotonic() >= deadline:
            future.cancel()
            raise TimeoutError("Timed out waiting for PNG export")
        process_events()
        time.sleep(0.005)
    payload = future.result()
    path.write_bytes(payload)
    return path
