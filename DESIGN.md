---
name: APQ Debugger
description: A DevTools-native panel that recovers the GraphQL query behind every Apollo persisted-query hash.
colors:
  surface: "light-dark(#ffffff, #202124)"
  surface-chrome: "light-dark(#f1f3f4, #292a2d)"
  surface-raised: "light-dark(#ffffff, #303134)"
  surface-sunken: "light-dark(#f8f9fa, #1b1c1e)"
  surface-hover: "light-dark(#eef1f6, #2f3236)"
  selection: "light-dark(#d3e3fd, #0f3a6e)"
  selection-idle: "light-dark(#e8eaed, #3c4043)"
  input-surface: "light-dark(#ffffff, #202124)"
  divider: "light-dark(#dadce0, #3c4043)"
  input-border: "light-dark(#80868b, #80868b)"
  raised-border: "light-dark(#c4c7c5, #5f6368)"
  ink: "light-dark(#1f1f1f, #e3e3e3)"
  ink-secondary: "light-dark(#5f6368, #a8acb1)"
  ink-disabled: "light-dark(#9aa0a6, #6f7378)"
  ink-on-selection: "light-dark(#041e49, #e3eefe)"
  devtools-blue: "light-dark(#0b57d0, #a8c7fa)"
  devtools-blue-hover: "light-dark(#0842a0, #c2d7fb)"
  on-devtools-blue: "light-dark(#ffffff, #062e6f)"
  focus: "light-dark(#0b57d0, #a8c7fa)"
  record-red: "light-dark(#d93025, #f28b82)"
  resolved-green: "light-dark(#137333, #81c995)"
  awaiting-amber: "light-dark(#8a5300, #fdd663)"
  error-red: "light-dark(#b3261e, #f2b8b5)"
  error-wash: "light-dark(#fce8e6, #3c1b18)"
  live-wash: "light-dark(#fef7e0, #3a3013)"
  live-border: "light-dark(#f2d68b, #6b5718)"
  live-ink: "light-dark(#3c2c00, #fdecb7)"
  passive-wash: "light-dark(#e8f0fe, #172b4d)"
  passive-border: "light-dark(#c2d7fb, #2c4a7a)"
  passive-ink: "light-dark(#062e6f, #d3e3fd)"
  update-flash: "light-dark(#fde293, #6b5718)"
  syntax-keyword: "light-dark(#aa0d91, #e36eec)"
  syntax-type: "light-dark(#0b57d0, #8ab4f8)"
  syntax-variable: "light-dark(#c5221f, #f28b82)"
  syntax-string: "light-dark(#1a1aa6, #f29766)"
  syntax-enum: "light-dark(#1c00cf, #b39ddb)"
  syntax-comment: "light-dark(#5f6368, #9aa0a6)"
typography:
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, Cantarell, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  code:
    fontFamily: "ui-monospace, Menlo, Consolas, 'Cascadia Mono', 'DejaVu Sans Mono', monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  code-small:
    fontFamily: "ui-monospace, Menlo, Consolas, 'Cascadia Mono', 'DejaVu Sans Mono', monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "\"tnum\" 1"
rounded:
  sm: "3px"
  md: "4px"
  lg: "8px"
  pill: "999px"
spacing:
  s-1: "2px"
  s-2: "4px"
  s-3: "6px"
  s-4: "8px"
  s-5: "12px"
  s-6: "16px"
  s-7: "24px"
components:
  button-toolbar:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "22px"
  button-toolbar-hover:
    backgroundColor: "{colors.surface-hover}"
  button-primary:
    backgroundColor: "{colors.devtools-blue}"
    textColor: "{colors.on-devtools-blue}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "22px"
  button-primary-hover:
    backgroundColor: "{colors.devtools-blue-hover}"
  button-danger:
    backgroundColor: "{colors.error-red}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "22px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    size: "24px"
  chip-filter:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "20px"
  chip-filter-active:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.ink-on-selection}"
  input-toolbar:
    backgroundColor: "{colors.input-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 6px"
    height: "22px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    padding: "0 12px"
    height: "28px"
  tab-active:
    textColor: "{colors.devtools-blue}"
  toolbar:
    backgroundColor: "{colors.surface-chrome}"
    padding: "2px 6px"
    height: "30px"
  table-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "0 8px"
    height: "24px"
  table-row-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.ink-on-selection}"
  table-row-selected-idle:
    backgroundColor: "{colors.selection-idle}"
  infobar-live:
    backgroundColor: "{colors.live-wash}"
    textColor: "{colors.live-ink}"
    padding: "4px 12px"
  infobar-passive:
    backgroundColor: "{colors.passive-wash}"
    textColor: "{colors.passive-ink}"
    padding: "4px 12px"
  code-block:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  menu:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.lg}"
    padding: "6px 0"
    width: "240px"
  dialog:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.lg}"
    padding: "16px"
    width: "400px"
---

# Design System: APQ Debugger

## Overview

**Creative North Star: "The First-Party Panel"**

APQ Debugger is built to be mistaken for a panel Chrome shipped itself. It sits beside Network and Elements, so it takes their system wholesale: 12px system UI type, monospace for anything machine-made (hashes, queries, URLs, timestamps), white and grey-100 surfaces (dark: #202124 / #292a2d) split by 1px dividers, Google blue for selection, focus and the one primary action, record red, a yellow infobar while traffic is being rewritten, and green reserved for a resolved hash. Familiarity is the design goal; personality is spent only on state changes.

The structure is the DevTools canon: a tab strip (Requests, Schema, settings gear and session status at the right), a per-view toolbar, an optional collapsible patterns pane, an infobar when interception or passive mode is on, then a dense single-line data table with a detail pane that appears only after selection. In the detail pane the recovered query is the largest, most readable thing on screen, wrapped and syntax-coloured in DevTools Sources colours. The system rejects the editorial card-and-metric dashboard and the permanent settings sidebar that preceded it.

Density is a working constraint, not a preference: the panel is often docked about 400px tall. Comfortable matches DevTools' default row height (24px), Compact its dense tables (20px), and Compact switches on by itself when the panel is 460px tall or less. The one signature moment is a pending APQ row resolving in place, its state flipping to Resolved under the DevTools "updated" flash.

**Key Characteristics:**
- System UI 12px for interface, ui-monospace for code, hashes, URLs and times; no bundled or network fonts.
- Flat in-flow surfaces separated by 1px dividers and tonal steps (surface vs chrome vs sunken).
- Blue means selection, focus or primary; red means recording; yellow means traffic is being rewritten; green means resolved.
- Every request state is a word plus a glyph shape, never colour alone.
- Single-line 24px (20px compact) table rows with column dividers.
- Every colour defined once with light-dark(); dark mode only flips color-scheme.

## Colors

A neutral DevTools grey-and-white field with a strict signal vocabulary: one blue, one red, one yellow, one green, each tied to a single meaning.

### Primary
- **DevTools Blue** (devtools-blue): the active tab label and its 2px underline, primary buttons (Load schema, Copy in the cURL dialog), link buttons and the checkbox accent. Its hover deepens to DevTools Blue Hover.
- **Focus Blue** (focus): the 2px focus outline on every interactive element and the resize handle's hover/drag state. Same value as DevTools Blue by design; kept as its own token so focus can diverge without touching actions.
- **Selection Blue** (selection): the selected row, schema type and active filter pill while their list has focus; text on it uses Ink on Selection. When the list loses focus the row drops to Selection Grey (selection-idle), exactly as DevTools does.

### Secondary
- **Record Red** (record-red): the record circle while recording, the "Intercepting" session status, and the pulsing dot in the live infobar. Nothing else.
- **Live Yellow** (live-wash, live-border, live-ink): the interception infobar ("Intercepting requests matching ...") and warning toasts. It appears only while requests are actually being rewritten or something needs attention.
- **Passive Blue Wash** (passive-wash, passive-border, passive-ink): the passive-mode infobar ("Requests are not modified"). Blue-grey, calm, informational.

### Tertiary (state)
- **Resolved Green** (resolved-green): the Resolved state word and its filled dot.
- **Awaiting Amber** (awaiting-amber): the Awaiting retry state (hollow ring), the "none" patterns summary warning, and the warning session status.
- **Error Red** (error-red, error-wash): Not in registry (dash glyph), schema load errors, error toasts, and the destructive confirm button.
- **Update Flash** (update-flash): the background a row starts from when it resolves in place, fading out over 1.2s.

### Neutral
- **Surface** (surface): the table, panes and detail body.
- **Chrome Grey** (surface-chrome): tab strip, toolbars, table head, group headers, code-block headers, detail head, inline code.
- **Raised** (surface-raised, raised-border): menus and dialogs.
- **Sunken** (surface-sunken): query, variables and SDL code bodies.
- **Hover** (surface-hover): hover wash on rows, tabs, buttons and menu options.
- **Divider** (divider): every 1px region split, column rule and resting input border; row bottoms use it at 55% strength.
- **Input Border** (input-border): input and select border on hover, chosen to reach 3:1.
- **Ink** (ink), **Ink Secondary** (ink-secondary), **Ink Disabled** (ink-disabled): primary text, secondary text (labels, column heads, hashes, times; at least 5.3:1 on surface and chrome), disabled controls.

### Syntax (DevTools Sources)
- **Keyword** (syntax-keyword) magenta, **Type** (syntax-type) blue, **Variable** (syntax-variable) red, **String** (syntax-string) deep blue / orange in dark, **Enum value** (syntax-enum) indigo / lavender, **Comment** (syntax-comment) grey italic. Used in the query and variables blocks and the schema SDL view only.

### Named Rules
**The One Meaning Rule.** Each signal colour has exactly one job: blue is selection, focus and the primary action; red is recording; yellow is live rewriting or a warning; green is a resolved hash. A colour never borrows another's meaning.

**The Yellow Means Rewriting Rule.** The yellow infobar is visible if and only if the debugger is attached and rewriting matching traffic; it names the patterns in monospace and carries Stop. Passive mode gets the blue infobar instead, because nothing is modified.

**The Define-Once Rule.** Every colour is declared once in tokens.css as `light-dark(light, dark)`. Dark mode is a `color-scheme` flip in theme-dark.css (explicit `data-theme` wins; otherwise the system preference). No component redeclares a colour per theme.

## Typography

**Interface Font:** system-ui (with -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif)
**Code Font:** ui-monospace (with Menlo, Consolas, Cascadia Mono, DejaVu Sans Mono, monospace)

**Character:** The platform's own faces at DevTools sizes. The UI face disappears into Chrome; the monospace face marks everything the machine produced, so a hash or URL is recognisable at a glance.

### Hierarchy
- **Title** (600, 13px, 1.4): detail pane operation name, empty-state titles, dialog titles. The largest UI text in the panel.
- **Body** (400, 12px, 1.4): everything by default: toolbar controls, rows, descriptions, menus, infobar copy.
- **Label** (500, 12px): operation names in rows, state words, column heads, record and primary buttons, menu group labels. Weight, not size, carries emphasis.
- **Code** (400, 12px mono, 1.5): query, variables and SDL bodies; wraps (`pre-wrap`, `overflow-wrap: anywhere`), tab size 2.
- **Code Small** (400, 11px mono, tabular numerals): short hashes, times, pattern inputs and summary, endpoint URLs, group headers, schema type names, inline code.

### Named Rules
**The Machine-Text Rule.** Anything the machine produced (hash, URL, pattern, timestamp, query, type name) is set in the monospace stack; anything a person reads as interface is in system-ui. Numbers that update in place use tabular numerals.

**The Flat Ramp Rule.** The ramp spans 11px to 13px. Hierarchy comes from weight (400/500/600), colour (ink vs ink-secondary) and position, never from display sizes. Sentence case throughout; no uppercase tracking, no eyebrows.

## Layout

A full-height column: tab strip (28px; 26px compact), toolbar (30px; 26px compact, wraps when crowded), optional patterns pane, optional infobar, then a horizontal split filling the rest. The split is the request table plus, only after a row is selected, a detail pane at `clamp(320px, 45%, 720px)` behind a 1px draggable resize handle (6px hit area, keyboard-focusable).

The request table is a four-column grid: Name `minmax(120px, 1fr)`, State 112px, Hash 76px, Time 76px, with 1px column rules and 8px cell padding. Rows group under sticky endpoint headers. The Schema view is a 240px type list beside a scrolling SDL pane.

Spacing runs on a 4px grid with half steps: 2, 4, 6, 8, 12, 16, 24px (`s-1` to `s-7`). Toolbars use 2px/4px gaps; panes pad 8px by 12px; the detail body pads 8px / 12px / 16px bottom with 8px between blocks; empty states and dialogs use the 16 and 24px steps.

Responsive behaviour is width-driven from a ResizeObserver on the app frame:
- **Narrow (< 640px):** the detail pane becomes a full overlay over the list; the Hash column, the "Patterns" label and pane descriptions drop; the filter input flexes.
- **Very narrow (< 420px):** the Time column, the resolved count and toolbar separators also drop; the schema type list narrows to 140px.
- **Short (height <= 460px):** compact density applies automatically.

**The Docked-First Rule.** Design for the panel docked about 400px tall: no chrome may cost more than one toolbar row plus the optional infobar before data rows begin.

## Elevation & Depth

Flat by default. In-flow regions are separated by 1px dividers and three tonal steps (surface, chrome, sunken), never by shadow. A single shadow exists for things that float above the panel: the settings menu, toasts and dialogs. Dialogs add a 35% black backdrop. Focus is an outline, not a shadow.

### Shadow Vocabulary
- **Overlay** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.3), 0 2px 6px 2px rgb(0 0 0 / 0.15)`): settings menu, toast, dialog panel. Nothing else.

### Named Rules
**The Overlays-Only Rule.** A shadow means "floating above the panel". Rows, panes, toolbars, code blocks and infobars never carry one.

## Shapes

Small, uniform corners in the DevTools idiom: 3px for inline code, kbd and skeleton bars; 4px for buttons, inputs, selects, code blocks, toasts and the cURL preview; 8px for menus and dialogs; full pill for the type-filter pills and endpoint count badges. Table rows, panes, toolbars and infobars are square, full-bleed bands. Code blocks are 1px-divider bordered boxes whose header and body share the 4px corner (header rounds the top, body the bottom; collapsed, the header rounds all four).

Icons are inline 16px stroke SVGs (1.75 stroke, round caps and joins, `currentColor`), shipped in the markup. State glyphs are 6 to 8px CSS shapes: filled dot, hollow ring, dash, diamond, small square.

## Components

### Buttons
Quiet toolbar controls that only show a surface when touched.
- **Shape:** gently squared (4px), 22px tall (20px compact), 8px horizontal padding, 4px icon gap.
- **Toolbar (default):** transparent with ink text; hover fills with the hover wash. On content surfaces (detail pane, patterns pane, dialog footers) the same button gains a 1px divider outline so it reads as a control.
- **Primary:** DevTools Blue fill, on-blue text, weight 500; hover deepens. One per view at most (Load schema; Copy in the cURL dialog).
- **Danger:** error-red fill, weight 500; used only as the accept button of a destructive confirm.
- **Icon button:** 24px square, ink-secondary glyph, hover wash; disabled drops to ink-disabled.
- **Record:** the Network panel's circle. Idle: hollow ink-secondary ring, "Record". Recording: filled record-red circle and red "Stop".
- **Link button:** blue underlined text (underline at 40% until hover); inside the infobar it inherits the bar's ink.
- **Focus:** 2px focus-blue outline, 1px offset (inset on tabs, rows, lists and code).

### Chips
- **Style:** the DevTools Network resource-type pills (All / APQ / Full): pill radius, 20px tall, transparent, ink text, hover wash.
- **State:** active pill fills with Selection Blue and Ink on Selection. In dialogs (cURL shell picker) inactive pills gain a divider outline.

### Inputs / Fields
- **Style:** 22px (20px compact), input surface, 1px divider border, 4px radius, 6px padding; placeholders in ink-secondary. Pattern and schema URL inputs use Code Small.
- **Hover:** border strengthens to input-border.
- **Focus:** border and outline go focus blue, outline inset 1px.
- **Checkboxes:** native, 14px, accent-colour DevTools Blue.

### Navigation
- **Tab strip:** chrome-grey band, tabs as 12px-padded text in ink-secondary; hover wash plus ink; selected tab turns DevTools Blue with a 2px underline that overlaps the strip's bottom divider. Right end holds the session status and the settings gear.
- **Session status:** one word plus an 8px dot. Idle: ink-secondary hollow ring. Intercepting: record-red, filled, weight 600. Passive: blue filled. Warning: amber. Error: error-red filled.

### Request Table (signature)
- **Head:** chrome-grey, ink-secondary labels at weight 500, 1px column rules.
- **Rows:** single line, 24px (20px compact), operation name at weight 500 (anonymous operations italic ink-secondary), state word, 8-character hash and time in Code Small ink-secondary. Hover wash; selected rows Selection Blue when the list is focused, Selection Grey otherwise; keyboard focus is a 1px inset focus outline.
- **States:** Resolved (green filled dot), Awaiting retry (amber hollow ring), Not in registry (error-red dash), APQ retry (secondary diamond, weight 400), Full query (secondary small square, weight 400). Words come from `request-state.js` and are shared with the detail pane.
- **Resolve in place:** when the APQ retry lands, the pending row is re-rendered where it sits (focus preserved) and its background fades from Update Flash to nothing over 1.2s on the standard ease. With reduced motion the flash becomes a 1px resolved-green inset outline instead.
- **Group headers:** sticky chrome-grey bands with the endpoint in Code Small and a tabular request count.

### Infobar
- **Live:** full-width yellow band under the toolbar: pulsing record dot (three pulses, then still), "Intercepting requests matching" followed by each pattern as inline code, an optional first-run note explaining the swap and Chrome's own debugging bar (dismissed with "Got it"), and an outlined Stop button.
- **Passive:** the same band in passive blue, no dot, states the registry size and that requests are not modified.

### Detail Pane
- **Head:** chrome-grey row with the operation name in Title and a close icon button.
- **Body:** facts line (state word, time, links), a one-line state description, a key/value grid (Endpoint, Hash with Copy) in Code Small, Copy as cURL, then collapsible code blocks: Query (min 72px, the dominant element) and Variables. Each block has a chrome-grey summary header with a rotating triangle, a weight-600 title and a borderless Copy that confirms in place ("Copied").

### Overlays
- **Settings menu:** 240px raised surface, raised border, 8px radius, overlay shadow; fieldset groups split by dividers (Theme, Density, Passive mode) with radio/check options as 26px rows and a keyboard-shortcut hint footer.
- **Toast:** bottom-right stack, inverted neutral (dark on light theme, light on dark), 4px radius, overlay shadow, rises 6px in over 200ms. Warning and error variants use the live yellow and error washes with a 1px border.
- **Dialog:** 400px (640px wide variant) raised panel, 16px padding, 8px radius, overlay shadow, 35% black backdrop; Title heading, secondary description, right-aligned footer (outlined Cancel, then primary or danger).

### Empty States and Loading
- **Empty:** left-aligned block up to 460px wide, Title heading, numbered steps with bold key terms, secondary description; a filtered variant hides the steps.
- **Schema skeleton:** 12px chrome-grey bars at 100/80/60/70% width with a 1.4s shimmer to the hover wash.

## Do's and Don'ts

### Do:
- **Do** take every colour from tokens.css and add new ones there as `light-dark(light, dark)` pairs with text at 4.5:1 and meaningful indicators at 3:1 in both themes.
- **Do** separate regions with 1px dividers and the surface / chrome / sunken tonal steps.
- **Do** express every request state as a word plus a glyph shape, using the vocabulary in `request-state.js`.
- **Do** set hashes, URLs, patterns, times and code in the monospace stack, and counts in tabular numerals.
- **Do** keep controls at the density heights (22/20px controls, 24/20px rows) so compact and the short-dock auto-compact keep working.
- **Do** keep the query block wrapped and dominant in the detail pane; the recovered query is the largest readable thing on screen.
- **Do** give every motion a reduced-motion fallback that keeps the meaning (the resolve flash becomes a green outline).
- **Do** support forced colours: selection maps to Highlight/HighlightText and floating layers get a CanvasText border.

### Don't:
- **Don't** add shadows to in-flow surfaces; the overlay shadow is for menus, toasts and dialogs only.
- **Don't** use green for anything except a resolved hash, or yellow except live interception and warnings.
- **Don't** signal state with colour alone.
- **Don't** load fonts, icons or scripts from the network, or ship a display face; the platform system-ui and ui-monospace stacks are the type system.
- **Don't** reintroduce the editorial card-and-metric dashboard, a permanent settings sidebar, uppercase tracked eyebrows or display numerals.
- **Don't** redeclare colours for dark mode; flip `color-scheme` only.
- **Don't** let the query scroll horizontally; it wraps.
