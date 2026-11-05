# Analysis chart contracts (Vesora 1.0.0)

Methods below exist on a JavaScript `Figure` or `Panel`. Python equivalents are snake_case. All return a mutable layer and accept normal Vesora style options where applicable. Raw source channels and analysis options travel in scene protocol 9 and offline HTML.

| Family | JavaScript | Supplied data / meaning |
| --- | --- | --- |
| Empirical distributions | `ecdf(samples, {complementary: false})`, `ccdf(samples)` | Unbinned empirical probabilities from finite samples; repeated samples are retained. Do not replace an ECDF with a cumulative histogram. |
| Spectrogram | `spectrogram(time, frequency, values, {maxRows: 256, valueScale: 'linear'})` | Matrix is **time × frequency**. Time samples follow a regular, strictly increasing cadence; missing hops require explicit NaN rows. Appends continue that cadence. Frequency coordinates may be nonuniform. `valueScale: 'db'` converts supplied nonnegative power with `10*log10(value/dbReference)`, clamped at `dbFloor`; do not supply already-logarithmic values. Returned layer has `appendRows(time, values)`. |
| Event timeline | `eventTimeline([{start, end, lane, label, id}])` | Numeric times; `end` may be omitted for an instantaneous event. Lane and label are presentation; no inferred causal relation. |
| Measurement bounds | `errorbar(x, y, {xLower, xUpper, yLower, yUpper, capSize: 6})` | Bounds are supplied coordinate values, not automatically computed confidence intervals. Bound arrays match sample count. |
| Contours | `contour(x, y, z, {levels: [0.25, 0.5]})`, `contourf(...)` | Numeric grid field; `z` follows grid row/column shape. Levels can be explicit values or a count. Masks/nonfinite cells must remain gaps. |
| Vector field | `quiver(x, y, u, v, {scale: 1, normalize: false})` | One x/y/u/v sample per vector; `normalize` changes visual lengths and must be disclosed if magnitude matters. |
| Parallel coordinates | `parallelCoordinates({temperature: [...], pressure: [...]}, {axes: [{key: 'temperature'}, {key: 'pressure'}]})` | Named columns of equal row count; explicit axes can set label, linear/log scale, domain and reverse. Dedicated projection. |
| Pareto frontier | `paretoFront(x, y, {objectives: ['min', 'min'], showAll: true, connect: true})` | Two objectives, each explicitly min/max. A frontier expresses dominance for these objectives, not a universal best choice. |
| Phase portrait | `phasePortrait(x, y, {time, sequence, direction: true, closed: false})` | Acquisition order is meaningful; do not sort by x. `hysteresis` is an alias. Pair with a time-domain plot when time matters. |
| Ternary composition | `ternary(a, b, c, {sum: 1, normalize: false, tolerance: 1e-6, labels: ['A', 'B', 'C']})` | Equal-length nonnegative component channels; each sample sums to the declared total unless normalization is explicitly requested. Dedicated projection. |

Use the installed declarations for complete optional properties. Preserve invalid-data errors and do not coerce arbitrary strings into numbers. Analysis layers are not automatically members of the older fixed scatter/scatter/histogram selection link.

Semantics reference **raw source channels**, not rendered axes. ECDF/CCDF use `samples` (not `x`); a spectrogram uses `x` = frequency, `y` = time and `z` = supplied power; parallel coordinates use `c0`, `c1`, … in axis order; ternary uses `a`, `b`, `c`. For example, `ecdfLayer.setSemantics({samples: {unit: 'ms'}})` declares the source sample unit.

Use `queryECDF(samples, {probability: 0.99, threshold: 30})` for a nearest-rank percentile and exact threshold counts; Python exposes `vs.query_ecdf(samples, probability=0.99, threshold=30)`. The pure query is separate from the chart layer. It reports omitted values, full membership counts and a bounded source-index preview. An empty finite dataset has a null quantile/probability; do not invent a threshold value for it.

Spectrogram's dirty-row GPU update path is most effective with an explicit fixed `colorDomain`. An automatically changing domain correctly requires renormalizing the retained texture. Do not advertise constant upload work for auto-ranging values or change the scalar meaning just to hit a performance target.
