# v0.5 researcher and analyst pilot

Test whether linked inspection makes a real analysis easier than participants' current tools. This is a protocol, **not completed user research**. Feature availability or a synthetic benchmark does not establish adoption.

## Participants and data

Recruit five researchers/data analysts: three who regularly inspect dense observations and two who use ordinary notebook datasets. Record each person's current tool, task frequency, typical row count and sharing method. Start with the deterministic [gallery](../examples/web/linked.html), then repeat with an aligned, numeric dataset they already use and can share for this exercise.

Use one observation table and three columns suitable for two scatter views and a count histogram. Explain that matching row positions identify observations; require the participant to check array order. Do not compare Vesora against a deliberately unfamiliar or disadvantaged baseline tool.

## Task

1. Install the provided v0.5 wheel and make the first figure. Record elapsed time, help requests and environment failures. No Node setup should be needed for the built Python wheel.
2. Find a suspicious group in one scatter. Select it and explain how the same observations differ in the other variable.
3. Report selected count/percentage and the histogram comparison. Ask what the histogram's count scale means and whether missing/range-excluded values affect selected count.
4. Pan, zoom and Reset view; confirm the cohort is preserved. Clear it, select an empty region and explain the distinction.
5. Save HTML, send it through the participant's ordinary sharing method and ask a second person to open it with networking disabled. Confirm the same selected group/count without installing Python.
6. Repeat the investigation using the participant's current tool and data. Record preparation code, time, mistakes, responsiveness and clarity.
7. Ask the participant to use Vesora for a real task during the next week; record whether they actually returned, what prevented use and why they would retain their current tool.

## Proposed success criteria

| Criterion | Target | Evidence |
| --- | --- | --- |
| First figure without help | At least 4/5 within 10 minutes | Timer, assistance log, environment |
| Correct group and row count | At least 4/5 | Independent source-data answer |
| Offline delivery | Every submitted file reopens with matching cohort/count | Sender/recipient observations |
| Repeat actual use | At least 3/5 within one week | Real task description and artifact |
| Dense-data benefit | At least 2/3 report less preparation or better interaction than their baseline | Paired task record, not feature preference alone |

Treat these as decision thresholds, not achieved outcomes. Analyze small-sample feedback qualitatively; do not turn five people into a general market-performance claim.

## Record findings

For each participant, keep: current tool and workflow; row count; machine/browser; install time; help requests; task answers; preparation code/time for both tools; performance observations; recipient result; repeat-use outcome; blockers and direct feedback with consent. Separate observed actions from participant predictions and researcher interpretations.

If linked inspection works but users do not switch, identify whether installation, missing uncertainty display, publication export or an already adequate Bokeh/HoloViews workflow is decisive. Choose the next change from those findings. Streaming and new chart types should not be added to compensate for an unproven cohort-analysis problem.
