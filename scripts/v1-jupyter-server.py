"""Isolated real JupyterLab with one all-ten-family widget workflow."""
from pathlib import Path
import json
import os
import secrets
import socket
import sys

root = Path(__file__).resolve().parents[1]
output = Path(os.environ["VESORA_V1_OUTPUT"]).resolve()
workspace = output / "jupyter-workspace"
workspace.mkdir(parents=True, exist_ok=True)
data = workspace / "jupyter-data"
kernels = data / "kernels" / "vesora-v1"
kernels.mkdir(parents=True, exist_ok=True)
target = Path(os.environ["VESORA_INSTALL_TARGET"]).resolve()
(kernels / "kernel.json").write_text(json.dumps({"argv": [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"], "display_name": "Vesora v1 validation", "language": "python", "env": {"PYTHONPATH": str(target), "PYTHONUTF8": "1"}}), encoding="utf-8")
for key, path in {"JUPYTER_PATH": data, "JUPYTER_RUNTIME_DIR": workspace / "runtime", "JUPYTER_CONFIG_DIR": workspace / "config", "IPYTHONDIR": workspace / "ipython", "JUPYTERLAB_SETTINGS_DIR": workspace / "settings", "JUPYTERLAB_WORKSPACES_DIR": workspace / "workspaces"}.items():
    os.environ[key] = str(path)
cells = [f'''from pathlib import Path
import runpy
import vesora as vs
assert Path(vs.__file__).resolve().is_relative_to(Path({str(target)!r})), vs.__file__
assert vs.__version__ == "1.1.0"
make = runpy.run_path({str(root / "skills/vesora/scripts/example_python.py")!r})["make_figure"]
fig = make()
fig.show(host="notebook")
await fig.savefig_async("advanced.png", timeout=35)
assert Path("advanced.png").read_bytes()[:8] == b"\\x89PNG\\r\\n\\x1a\\n"
print("VESORA_V1_NOTEBOOK_RENDERED")''', '''widget = fig._widget
fig.close()
assert widget._vesora_closed and not widget._views
assert fig._closed and not fig._sources
print("VESORA_V1_NOTEBOOK_CLEANED")''']
notebook = {"nbformat": 4, "nbformat_minor": 5, "metadata": {"kernelspec": {"name": "vesora-v1", "display_name": "Vesora v1 validation", "language": "python"}}, "cells": [{"cell_type": "code", "id": f"v1-{i}", "execution_count": None, "metadata": {}, "source": source, "outputs": []} for i, source in enumerate(cells)]}
(workspace / "v1.ipynb").write_text(json.dumps(notebook), encoding="utf-8")
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
token = secrets.token_urlsafe(24)
from jupyterlab.labapp import LabApp
app = LabApp.initialize_server(argv=["--no-browser", "--ServerApp.ip=127.0.0.1", f"--ServerApp.port={port}", "--ServerApp.port_retries=0", f"--IdentityProvider.token={token}", f"--ServerApp.root_dir={workspace}", "--ServerApp.allow_remote_access=False", "--ServerApp.open_browser=False", "--LabApp.check_for_updates_class=jupyterlab.handlers.announcements.NeverCheckForUpdate"])
print("VESORA_V1_JUPYTER " + json.dumps({"url": f"http://127.0.0.1:{port}", "token": token}), flush=True)
app.start()
