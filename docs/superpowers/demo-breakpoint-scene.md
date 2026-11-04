# Proposed demo scene: request breakpoints

For the owner to merge into `store/promo/video/demo-script.md` (not edited directly, because that file holds uncommitted work). Suggested placement: between Scene 7 (Copy as cURL) and Scene 8 (Find things fast), renumbering the scenes after it and adding about 16 seconds to the length. `scripts/promo/record-demo.js` will need the matching steps before re-recording with `npm run promo:video`.

Panel ids for the recorder: `#tab-breakpoints`, `#bp-list .bp-name`, `#bp-debug-mode`, `#bp-infobar-text`, `#bp-tab-variables`, `#bp-variables`, `#bp-resume`.

---

## Scene 7b · Pause and edit a request (1:00–1:16)

- **Action:** click the **Breakpoints** tab. Click the empty breakpoint field, type `AddToCart`, press Enter, then tick **Debug mode**. Click **Add** on a product in the store: the request is held before it is sent, the Breakpoints tab shows it under **Paused requests** with a **Paused** chip, the infobar reads "Paused on AddToCart" and the tab-strip status reads **Paused**. The store's cart count does not change.
- **Caption:** "Set a breakpoint on an operation name. Matching requests pause before they are sent."

- **Action:** click **Variables** in the editor and change `"quantity": 1` to `"quantity": 3` (the tab gains an "edited" marker). Click **Resume this**. The request goes out with the edited variables, the cart count jumps to 3, the infobar disappears and the status returns to **Intercepting**. Untick **Debug mode**.
- **Caption:** "Edit the query, variables or headers, then resume. Only the request waits; the page keeps running."
