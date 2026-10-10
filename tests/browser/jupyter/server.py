"""Run an isolated real JupyterLab for the opt-in browser integration test."""
from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import socket
import tempfile


def main() -> None:
    root = Path(__file__).resolve().parents[3]
    with tempfile.TemporaryDirectory(prefix="vesora-jupyter-") as temporary:
        workspace = Path(temporary)
        kernels = workspace / "jupyter-data" / "kernels" / "vesora-test"
        kernels.mkdir(parents=True)
        import sys
        (kernels / "kernel.json").write_text(json.dumps({
            "argv": [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
            "display_name": "Vesora integration", "language": "python",
            "env": {"PYTHONPATH": str(root / "python")},
        }), encoding="utf-8")
        os.environ["JUPYTER_PATH"] = str(workspace / "jupyter-data")
        os.environ["JUPYTER_RUNTIME_DIR"] = str(workspace / "runtime")
        os.environ["JUPYTER_CONFIG_DIR"] = str(workspace / "config")
        os.environ["IPYTHONDIR"] = str(workspace / "ipython")
        os.environ["JUPYTERLAB_SETTINGS_DIR"] = str(workspace / "settings")
        os.environ["JUPYTERLAB_WORKSPACES_DIR"] = str(workspace / "workspaces")
        cells = [
            '''import vesora as vs
from pathlib import Path
fig = vs.subplots(2, 2, sharex=True, title="Real Jupyter comparison", width=900, height=680)
layers = []
for row in range(2):
    for col in range(2):
        panel = fig.panel(row, col).set_title(f"Panel {row}, {col}")
        panel.set_axes(ylim=(0, 5))
        layers.append(panel.scatter([1, 2, 3], [1, 3, 2], color="#38bdf8", size=12))
        panel.axhline(2, color="#d36a55")
note = fig.panel(1, 1).text(1, 4, "Initial", font_size=14)
fig.bookmark("Overview")
fig.show()
await fig.savefig_async("overview.png", timeout=45)
print("VESORA_WIDGET_READY")''',
            '''scene = fig.snapshot()["figure"]
assert "xDomain" in scene["view"], "The browser wheel interaction must reach Python"
assert scene["panels"][3]["view"]["xDomain"] == scene["view"]["xDomain"]
layers[-1].set_data(y=[4, 1, 3])
note.update(text="Updated")
fig.bookmark("Zoomed")
await fig.savefig_async("updated.png", timeout=45)
assert Path("updated.png").read_bytes() != Path("overview.png").read_bytes()
print("VESORA_UPDATED_AND_EXPORTED")''',
            '''fig.restore_bookmark("Overview")
scene = fig.snapshot()["figure"]
assert "xDomain" not in scene["view"]
assert all("xDomain" not in panel["view"] for panel in scene["panels"][1:])
await fig.savefig_async("restored.png", timeout=45)
print("VESORA_BOOKMARK_RESTORED")''',
            '''widget = fig._widget
fig.close()
assert widget._vesora_closed
assert not fig._listeners and not fig.snapshot()["sources"]
print("VESORA_CLEANED_UP")''',
        ]
        notebook = {"nbformat": 4, "nbformat_minor": 5,
                    "metadata": {"kernelspec": {"name": "vesora-test", "display_name": "Vesora integration", "language": "python"}},
                    "cells": [{"cell_type": "code", "id": f"vesora-cell-{i}", "execution_count": None,
                               "metadata": {}, "source": source, "outputs": []} for i, source in enumerate(cells)]}
        (workspace / "vesora-host-test.ipynb").write_text(json.dumps(notebook), encoding="utf-8")
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        token = secrets.token_urlsafe(24)
        from jupyterlab.labapp import LabApp
        app = LabApp.initialize_server(argv=["--no-browser", "--ServerApp.ip=127.0.0.1", f"--ServerApp.port={port}",
                        "--ServerApp.port_retries=0", f"--IdentityProvider.token={token}",
                        f"--ServerApp.root_dir={workspace}", "--ServerApp.allow_remote_access=False",
                        "--ServerApp.open_browser=False", "--LabApp.check_for_updates_class=jupyterlab.handlers.announcements.NeverCheckForUpdate"])
        print("VESORA_JUPYTER " + json.dumps({"url": f"http://127.0.0.1:{port}", "token": token,
                                             "workspace": str(workspace)}), flush=True)
        app.start()


if __name__ == "__main__":
    main()
