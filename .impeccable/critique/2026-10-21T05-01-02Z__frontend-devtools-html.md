---
target: DevTools panel
total_score: 17
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\ishab\\projects\\apq-debugger\\frontend\\devtools.html"
target_fingerprint: "sha256:ff29165fbb1567ffacc53a9ca6ae9fc5dbda938cfc5f24783f3d3ddc0c3cee4e"
target_path: "C:\\Users\\ishab\\projects\\apq-debugger\\frontend\\devtools.html"
timestamp: 2026-10-21T05-01-02Z
slug: frontend-devtools-html
---
# Critique: APQ Debugger DevTools panel (frontend/devtools.html)
Method: dual-agent. Score 17/40 (Poor).

Heuristics: 1 Status 2 | 2 Match 2 | 3 Control 2 | 4 Consistency 1 | 5 Error prevention 2 | 6 Recognition 2 | 7 Efficiency 1 | 8 Aesthetic 2 | 9 Recovery 2 | 10 Help 1

Specificity: Kora's editorial identity (Italiana, cream canvas, grain, tracked mono eyebrows) is distinctive but foreign to a DevTools tool; nothing derives from hashes/interception/resolution.

Detector (rendered, light): low-contrast FULL badge 3.95 (dark 3.66), selected-row text 4.2 (dark 3.8), chips 4.35/4.49, primary hover 4.4; tiny-text detail URL 11px; flat-type-hierarchy; cream-palette (intentional); monotonous-spacing (weak). Static cramped-padding on modal = false positive.

Priority issues:
- [P0] Docked layouts break: 520x400 detail placeholder blocks clicks on list; 760x420 sidebar+metrics leave <2 rows. -> adapt
- [P1] Wrong register; Italiana numerals misread (components.css:726), eyebrows, grain. -> typeset, quieter
- [P1] Query buried (one-line pre, h-scroll) + variables render as $1 (js/ui/request-detail.js:144). -> layout
- [P1] Settings popover has no surface; focus halo cancelled on tabs/rows by reset block components.css:70-95. -> harden
- [P2] No live/intercepting state, no safety framing at Start, resolved vs unresolved indistinguishable. -> clarify, onboard

Personas: Alex (no shortcuts, >10 tab stops), Sam (no focus on tabs/rows, noisy live region, toggle state unannounced), Priya (docked 400px: ~4 rows visible, no status/timing).
