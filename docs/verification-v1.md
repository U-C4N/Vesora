# Bounded automatic verification for Vesora 1.1.0

Run `npm run verify:next`. This is one verification of this version, not a daily/nightly testing policy. Its default and maximum wall-clock budget is **600,000 milliseconds**, beginning before environment validation and including build/local packaging. A smaller budget is available with `-- --budget-ms NUMBER`.

Prerequisites: installed Node modules, Python test/build dependencies, WebGL2 Chrome/Chromium, PySide6/QtWebEngine, and JupyterLab + ipykernel + anywidget. Set `VESORA_PYTHON`/`VESORA_CHROME` to select executables. The project `.venv` is detected. Dependency installation is outside the budget; verification makes no network package installs.

## Stages

1. Verify required host dependencies; build core, matching Python assets and React once.
2. Run core/React tests, Python tests, type checks, release guard contracts, the production React example build and local candidate packaging. Independent CPU processes run concurrently; Vitest workers are bounded.
3. Check legacy JS/Python parity; execute JS/Python skill galleries and compile the React guide against actual APIs.
4. Run version 1 browser tests with `playwright.v1.config.ts` and real WebGL2. Exercise all three actual workspaces in the plain browser, production React UI and Vite development React route with StrictMode: completed-frame readiness without stale disposed-view errors, frozen acquisition, retained bounds, comparison delta, cohort selection/table paging, theme and dataset replacement.
5. Validate exact archive checksums/runtime hashes; extract core/React into an isolated consumer; execute its gallery; open every packaged demo offline and export advanced PNG. Open the Python skill HTML offline too.
6. Install the exact wheel without dependencies into an isolated directory. Render all ten families through hidden QtWebEngine and a two-cell real JupyterLab widget. Check PNG and source/widget cleanup.

Missing dependencies, assertions and timeouts fail required stages. No `--skip-hosts` success mode exists. Pre-existing optional pytest cases may remain skipped in the headless stage; required Qt/Jupyter results are separate. The global deadline terminates owned subprocess trees and fails the command.

## Evidence and limits

Each run creates `artifacts/v1-verification/TIMESTAMP/` with `report.json`, per-stage logs, installed consumers, host reports and images. The report kind is `bounded-automatic-verification` and records version, budget, durations, statuses and explicit exclusions. The duration target is established by a completed report, not by the configured timeout.

Evidence covers automatic correctness, real rendering, integration and short cleanup. It does not establish hours of acquisition, universal performance, human screen-reader use or a five-participant pilot. Seeded/differential/metamorphic scenarios make rare transitions reproducible without waiting; they are not elapsed-duration soak evidence.

## Publication policy and historical gates

On 5 November 2026 the owner explicitly approved a v1 release using bounded automatic checks, with incomplete long-duration and human tests disclosed. Major version 1 therefore uses the `v1-bounded-automatic` publication policy: `correctness`, `browser`, `qt`, `jupyter`, `reactConsumers`, `packages` and `performance` must each have actual reviewed evidence bound to the final clean, tagged archives. Qt/Jupyter cover their real installed-wheel workflows; React consumers cover independent Vite/Next installs; performance covers short fixed probes. This does not claim the older long host/recovery or endurance criteria.

The policy must explicitly retain three **unverified** scopes: long-duration endurance including the two-hour soak, real screen-reader/human accessibility evaluation, and the five-person unaided pilot. They are not represented as passed publication gates. Missing or altered policy metadata, any missing automatic gate, stale evidence and invented deferred gate entries fail validation.

The verifier writes separate reports. It does not edit `release-gates.json`, mark any gate passed, rebuild old RC directories, move tags or publish. It also runs candidate packaging, so run it before final clean-tag packaging and verify the final archives directly afterward. Version 0.x retains all ten historical gates and its existing evidence format; no failed or missing historical evidence is changed. Protocol 9 manifests/the v1 advanced demo are recognized without weakening older protocol 7/8 archive verification. [v1 publication scope](releases/v1.0.0.md#approved-v1-publication-policy--5-november-2026)

## Recorded result

The completed local run on 5 November 2026 is the **1.0.0** result: it passed every required stage in **45.528 seconds**, including build, packaging, production React/browser workspaces, offline archives and the exact installed wheel's real Qt/Jupyter checks. See the [report](../artifacts/v1-verification/2026-11-05T07-57-14-862Z/report.json) and [1.0.0 evidence summary](releases/v1.0.0.md). That run is not a 1.1.0 publication record. Setup/download time is excluded as defined above; earlier failed reports remain preserved. [1.1.0 notes](releases/v1.1.0.md)
