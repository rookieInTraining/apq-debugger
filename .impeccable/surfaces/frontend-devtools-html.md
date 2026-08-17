---
version: 1
slug: "frontend-devtools-html"
primary_target: "frontend/devtools.html"
related_targets: []
---

# Surface brief: DevTools panel

Scope: the whole APQ Debugger DevTools panel (frontend/devtools.html, frontend/css/*, js/ui/*). Visitor mode: Operate.

Audience/job: GraphQL developers mid-investigation in Chrome DevTools, often docked ~400px tall beside Network. Task: start interception on matching URLs, watch operations arrive, read and copy the recovered query/variables, optionally browse the schema. Constraints: MV3, Chrome 123+, nothing loaded from the network, keyboard and screen-reader operable, light and dark.

User decisions (2026-10-21): direction pinned to DevTools-native (the category standard played straight; sits alongside Chrome DevTools Network/Elements panels at their craft level); full redesign incl. structure; bugs folded in; live bar plus first-run note for Start (no modal).

## Direction contract

THESIS: A panel that reads as a first-party DevTools tool: Network-style toolbar, single-line data rows, a detail pane where the recovered query is the largest, most readable thing. Refuses the editorial card-and-metric dashboard with a permanent settings sidebar.

OWN-WORLD: Chrome DevTools system: system-ui 12px and ui-monospace for code/hashes; white/grey-100 surfaces (dark #202124/#292a2d) split by 1px dividers; Google blue for selection, focus and primary; record red; yellow infobar for live interception; green only for resolved; DevTools Sources syntax colours.

STORY: The user sees at once whether traffic is being rewritten and on which patterns, watches hashes arrive and resolve, opens one and copies the query.

FIRST VIEWPORT: Row 1 tab strip (Requests, Schema; settings gear right). Row 2 toolbar: record/stop, clear, export, filter, All/APQ/Full, endpoint select, Patterns toggle with summary, count "5 · 4 resolved". Optional collapsible patterns pane under it. Yellow live bar when intercepting. Table: Name, State, Hash, Time. Detail pane (right; full overlay when narrow) only after selection: name + state line, meta grid, wrapped highlighted query, variables.

FORM: DevTools-native canon (user-pinned standing exit, position: canon). Signature move: a pending APQ row resolves in place when its retry lands (state flips to Resolved with the DevTools update flash). Roll skipped: the user pinned the direction, which beats the roll.
seed: none

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
