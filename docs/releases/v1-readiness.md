# Work remaining before v1

PRISM is still a release candidate. This list separates unfinished v0.9 acceptance work from decisions for v1; it does not turn missing release evidence into deferred optional work.

| Item | Current state | Completion or decision required |
| --- | --- | --- |
| Finish v0.9 acceptance | RC5 failed line first-ready and Jupyter recovery gates; RC6 contains targeted fixes and needs fresh archive-bound evidence. Two-hour soaks, human pilot and screen-reader results remain pending | Complete the [release gates](v0.9.0.md), retain failures, publish only verified archives, then verify downloaded exact versions |
| Confirm the public inspection contract | Snapshot ownership, accepted/rendered revisions, protocol 7 and transport 3 are implemented | Review pilot/integration findings and resolve documented API ambiguities before promising v1 stability; retain protocol 1–6 and transport v2 compatibility |
| Reduce cold 3D picking latency | The projected index is reused until source or camera changes; rebuilding a large index can pause interaction | Measure an object-space or cooperative index design against the same depth, clipping, source-identity and stale-frame tests; retain exact results |
| Evaluate the streaming optimization targets | Short reference measurements are available; they do not prove the 30-minute targets | Report p95 ≤50 ms, p99 ≤100 ms and worker transfer reduction ≥80% against the fixed baseline, or explicitly record which targets were missed |
| Decide which Labs APIs can become stable | Bounded trajectories, rolling surfaces and two A/B pins are experimental | Require identity, export, bounded-memory and lifecycle evidence before promotion; keep unstable APIs isolated |
| Revisit automatic adaptive surface detail | Not shipped; the manual sampling helper is not automatic LOD | Design interaction-time approximation with an explicit approximate-state indicator and exact resting/export semantics, then run its acceptance tests before distribution |
| Resolve host coverage gaps | Windows Chromium, Qt and real Jupyter are the declared gate hosts; Firefox/WebKit are smoke targets | Record the final exact version matrix. Jupyter reconnect during the long soak remains untested. Decide support scope explicitly; do not infer Safari/iOS or other desktop support from automation |

Volume rendering, arbitrary mesh/plane slicing, a general WebGPU backend, persistent recording, external history providers and SVG/PDF export remain separate product decisions. They are not implied v1 commitments or substitutes for completing v0.9.
