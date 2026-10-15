"""Read-only exact-wheel membership/dependency check, safe before GPU scheduling."""
import importlib.util
import json
import sys
from pathlib import Path

location = Path(__file__).with_name("host_workload.py")
spec = importlib.util.spec_from_file_location("vesora_soak_workload", location)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
evidence = helper.provenance()
assert evidence.get("verified_wheel_members"), "Supply VESORA_SOAK_WHEEL and VESORA_INSTALLED_PACKAGE=1"
assert Path(evidence["module"]).is_relative_to(Path(sys.prefix).resolve()), "Vesora must be installed in this environment"
dependencies = ("aiohttp", "anywidget", "pytest") if "--headless" in sys.argv else ("PySide6.QtCore", "aiohttp", "anywidget", "jupyterlab", "ipykernel", "pytest")
for module in dependencies:
    __import__(module)
print(json.dumps(evidence))
