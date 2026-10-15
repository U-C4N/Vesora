# Run the v0.9 real-host soaks

These runners keep three 100,000-point series bounded while submitting atomic 100-row batches at a requested 20 Hz. Every hundred batches includes a tenfold burst. The default producer duration is **7,200 seconds for each host**. A shorter validation run reports its actual duration and `two_hour_duration_met: false`; preparing or running a short check does not pass the release soak gate.

Use one graphics workload at a time. Build the candidate, install its exact wheel into an isolated environment with the required Qt/Jupyter test dependencies, and run from the repository. `VESORA_SOAK_WHEEL` checks every installed `vesora/` member against that wheel and records its SHA-256. Setting only a version string is insufficient. The following PowerShell commands assume `$soakPython` points to that isolated environment's Python executable and `$soakWheel` to the exact candidate wheel.

The execution driver prepares a separate environment using `uv`, verifies the wheel against the release manifest and installed member bytes, and runs Qt followed by Jupyter. Preparation loads no graphics host. Without `--prepare`, it reuses the verified environment and does not reinstall packages while another test is running.

```powershell
node scripts/run-host-soaks.mjs --prepare-only
node scripts/run-host-soaks.mjs --phase short
node scripts/run-host-soaks.mjs --phase full
```

An explicit release directory may be the first argument. Use `--env`, `--python` (base interpreter for environment creation), `--output` and `--host qt|jupyter|both` to choose locations or one host. `--phase both` runs short validation before full validation. Each invocation uses a fresh timestamped output directory by default. Full mode explicitly restores the required duration, retention, batch size and cadence, so leftover short-run environment variables cannot silently weaken the long gate.

```powershell
$env:VESORA_PYTHON = $soakPython
$env:VESORA_INSTALLED_PACKAGE = '1'
$env:VESORA_SOAK_WHEEL = $soakWheel
$env:PYTHONPATH = ''
$env:VESORA_SOAK_SECONDS = '7200'
$env:VESORA_SOAK_OUTPUT = (Join-Path (Get-Location) 'artifacts/soak-v09/qt')
$env:VESORA_SOAK_QT = '1'
& $soakPython -m pytest tests/python/test_v09_soak_desktop.py -q -s -o pythonpath= -p no:cacheprovider
Remove-Item Env:VESORA_SOAK_QT

$env:VESORA_SOAK_OUTPUT = (Join-Path (Get-Location) 'artifacts/soak-v09/jupyter')
$env:VESORA_SOAK_JUPYTER = '1'
npx playwright test --config playwright.jupyter-soak.config.ts --trace off --workers 1
Remove-Item Env:VESORA_SOAK_JUPYTER
```

For an initial short validation, set `VESORA_SOAK_SECONDS=30`, `VESORA_SOAK_FREEZE_EVERY=8`, `VESORA_SOAK_FREEZE_HOLD=2`, and `VESORA_SOAK_RETENTION=1000`. For the full gate, remove these three workload overrides (or explicitly restore 300 seconds, 10 seconds and 100000 points) and set the duration back to 7200. Each host needs a separate output directory. Source development runs may omit `VESORA_INSTALLED_PACKAGE` and `VESORA_SOAK_WHEEL`; use the source Python path for Qt and the ordinary development interpreter for Jupyter. Such runs never count as exact-wheel validation.

## What the reports establish

The producer records acceptance and completed **live frame** coverage separately. Every accepted atomic batch must be covered by a frame before final drain. Later frames may cover coalesced batches. Deliberate frozen waits have their own presentation histogram; acceptance latency is never presented as rendering latency. Histograms use eight logarithmic buckets per doubling, so percentile fields are explicit upper bounds. Requested and observed batch rates, producer duration, total elapsed duration and all retained source sequence/value checks are reported.

Periodic freeze cycles keep ingestion running and export the displayed HTML and PNG. Every HTML validates aligned sequence ranges across all three channels and their source values. Qt checks each renderer frame's three displayed stream states, forces one real WebSocket disconnect while frozen, verifies snapshot re-registration, resumes, and checks zero snapshot/export reservations. Jupyter drives the actual widget's Freeze, Return to live and export buttons while an asyncio producer runs in its real kernel; it also reopens an exported snapshot offline. Jupyter reconnection is explicitly untested because this fixture exposes no supported stable-session comm reconnect control.

The final JSON requires drained transport queues, exact final sequence counts and cleared Python host resources. It includes source bytes, queue peaks, Python-process RSS, renderer identity, and host/framework versions. Qt additionally records public core diagnostics. Jupyter records scoped viewer DOM diagnostics and optional Chromium heap; these DOM selectors are test fixtures rather than public API. Python RSS excludes WebEngine/browser processes, and no GPU or worker memory estimate is inferred from it. Inspect trends and any memory limitations when reviewing release evidence.

`qt-soak.json` and `jupyter-soak.json` are the final reports. `progress.json` updates during production; frozen HTML/PNG files and Jupyter's producer report are retained beside them. Both a passed report and `two_hour_duration_met: true` plus `exact_wheel_verified: true` are necessary for the promised exact-wheel two-hour gate. These runners do not execute the separate browser-only soak or beta pilot.

## Concurrent stress runs

Sequential runs are the latency reference. On a machine with sufficient measured CPU and memory headroom, independent browser, Qt and Jupyter processes can run concurrently to exercise resource contention. Set `--profile concurrent-stress` on each host-driver invocation and `VESORA_SOAK_PROFILE=concurrent-stress` for the browser runner; use distinct output directories and keep the archive/environment unchanged. Reports then set their latency-reference flag false. The driver still runs selected hosts sequentially; run separate `--host qt` and `--host jupyter` processes only when deliberately scheduling concurrent stress.

Each figure retains 4.8 MB of numeric source values at the full workload, plus frame snapshots, workers, geometry, WebGL targets, Python buffers and browser/Qt processes. The source figure alone is not a process-memory estimate. Measure process-tree peaks during short runs and leave operating-system headroom before starting all three. On the development machine, the pre-run inventory was 32 logical CPU threads and 31.7 GiB RAM, with approximately 11.7 GiB free; these observations do not promise that every simultaneous workload will fit. Periodic standalone exports also consume disk space, typically hundreds of MB over the complete host matrix depending on runtime size and PNG content.

Fast accounting checks, without opening a graphics host:

```powershell
python -m pytest tests/soak/test_accounting.py -q
```
