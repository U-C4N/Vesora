# v0.6 React/TypeScript SaaS developer pilot

Test whether developers can integrate Vesora into a real SaaS application and choose to use it again. This document is a protocol, **not completed user research**. Passing code tests, offering more chart types or showing synthetic performance does not establish adoption.

## Participants and setup

Recruit five web developers who maintain React/TypeScript SaaS dashboards. Record their current chart library, React/bundler versions, browser, typical data size, design system, API refresh pattern and a real chart task. Include developers using their usual Recharts, Chart.js, ECharts or other adequate baseline; do not force an unfamiliar alternative.

Provide the matching v0.6 core and React packages, the React API documentation and the [SaaS starter](../examples/react-saas/). The current developer preview uses local `.tgz` archives. npm publication is a separate authenticated step; do not present archive installation as successful registry adoption. Record package acquisition and installation time separately so the preview's distribution friction remains visible.

Participants must use their own non-sensitive API response or a representative local fixture. Keep numeric timestamps as epoch milliseconds, state which timezone/locale the product needs and confirm category order and stable series keys. Record the rows actually supplied to the chart; aggregation before plotting is part of the baseline workflow.

## Tasks and evidence

1. Start from the participant's own React/TypeScript project. Install the supplied packages and create a first line or bar chart using the documentation. The researcher observes without assistance and records time, errors and help requests.
2. Make a card using the participant's own data. Match their light/dark theme, format dates and numbers as needed, then refresh data without replacing the surrounding page. Demonstrate loading, empty and error/retry states.
3. Integrate with the app: customize a tooltip, use a click to update a detail view and control series visibility. Resize the container and navigate away/back. Record stale data, lost view state, leaked listeners/contexts, accessibility barriers or broken layout.
4. Build the same useful result with the participant's usual library. Record time, custom integration code, required data preparation, design compromises, bundle measurements and visible responsiveness. Use equivalent data and comparable features; do not compare a full competitor bundle with a reduced Vesora feature set.
5. If export matters to this participant, export PNG and HTML, then reopen HTML offline. Explain that HTML contains every chart source row and omits React callbacks and live API connections. Record correctness, file size and whether this behavior is useful in their actual workflow.
6. Ask the participant to integrate one real application task during the first week. In the second week, record whether they independently use Vesora again for another real task. Collect artifacts or a walkthrough with consent; distinguish completed behavior from intentions.

## Agreed decision thresholds

| Criterion | Target | Evidence |
| --- | --- | --- |
| First chart without assistance | At least 4/5 within 15 minutes | Timer, installation log, help requests and working chart |
| Own-data card with theme and refresh | At least 4/5 | Working card using their data, correct theme and observed refresh |
| Real application integration | At least 3/5 within one week | Application artifact or observed integration |
| Repeat actual use | At least 2/5 on a real task in the second week | Second task and resulting artifact |

These are acceptance thresholds, not achieved results. The own-data card has no additional time-limit requirement. Analyze this small sample qualitatively; do not convert five participants into a market-share or universal performance claim.

For each participant, retain environment details, baseline library, dataset size, task frequency, install/first-chart times, preparation and integration code, observed task failures, exports when relevant, first-week integration, second-week repeat use and reasons to keep their current tool. Measure raw/minified/gzip bundle sizes consistently and record the exact versions/configuration.

Choose the next change from repeated observed blockers. React integration, data refresh, visual design or a specific missing chart may be decisive; do not assume WebGL, Python parity or a larger chart catalog is what makes a SaaS developer adopt the product.
