---
name: vesora
description: Build or update scientific visualizations and embedded charts with the Vesora Python, JavaScript, and React library. Use for Vesora figures, live inspection, analysis charts, linked views, and offline exports; not for generic chart requests that do not use Vesora.
---

# Vesora

Use the installed Vesora API, preserve source meaning, and produce a working chart in the user's chosen host. These examples target **Vesora 1.0.0**, scene protocols 1–9. Check the actual package version before using the new analysis APIs; do not silently assume an older version supports them.

## Choose the host and chart

- Python: read [references/python.md](references/python.md). Python uses snake_case options, JS uses camelCase.
- JavaScript/TypeScript: read [references/javascript.md](references/javascript.md). Prefer `@vesora/core/runtime` and async HTML export for browser startup.
- React: read [references/react.md](references/react.md). Use `VesoraChart` for its supported declarative card types; use `VesoraViewer` with an application-owned `Figure` for analysis charts.
- Choose an analysis chart and its data contract from [references/analysis.md](references/analysis.md). Read only the relevant sections.
- For event-aligned run comparison or stable-ID cohorts across charts and a table, read [references/workflows.md](references/workflows.md).

Use the smallest chart that answers the task: ECDF/CCDF for distribution thresholds; spectrogram for supplied time–frequency matrices; event timeline for intervals; errorbar for supplied measurement bounds; contour/quiver for grid/vector fields; parallel coordinates/Pareto for alternatives; phase portrait for ordered trajectories; ternary for three-component composition.

## Preserve the contracts

- Do not fabricate uncertainty, FFT results, units, missing samples, or causal/anomaly explanations. Spectrogram values are supplied; Vesora does not infer a signal-processing pipeline. Record external transforms in semantics when relevant.
- 2D and 3D panel kinds are fixed. Ternary and parallel-coordinate projections belong in their own empty 2D panels. Do not mix them with Cartesian layers or shared Cartesian axes.
- Stable bounded streaming applies to numeric 2D line/scatter. Await JS append promises; use batch append for atomic series updates. Spectrogram's `appendRows`/`append_rows` is a separate bounded matrix API. Do not assume every chart streams.
- A displayed export captures the last completed frame, including a frozen observation; accepted exports capture latest accepted data. Preserve the requested meaning. HTML contains a retained snapshot and matching runtime, not a live producer, callbacks, or evicted history. PNG is an image.
- Hover on an aggregate is not an original row. Selection event indices are a bounded preview; do not use their length as the full cohort count.
- Call viewer `dispose()` when its host unmounts; call `Figure.close()` only when the owner no longer needs it. React-owned charts handle their own lifecycle.
- Use public methods; do not mutate `spec`, registries, or private Python fields in user code. Surface exact API/shape validation errors rather than filling missing data with zero.

## Verify the result

Run the relevant example and a real rendered check when the environment provides WebGL2. For changes to Vesora itself, use the repository's `npm run verify:next`; its bounded automated report is separate from historical release/publication gates. Do not launch long soak runs just to validate a chart.

Runnable gallery examples: [scripts/example_js.mjs](scripts/example_js.mjs), [scripts/example_python.py](scripts/example_python.py), and [scripts/example_react.tsx](scripts/example_react.tsx). They exercise all ten analysis families. Adapt the data and labels, then verify the actual output; do not merely reproduce the example text.
