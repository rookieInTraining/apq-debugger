# APQ Debugger: demo video script

**Length:** about 80 seconds · **Frame:** 1280×800 (store screenshot size), 30 fps, MP4 (H.264) · **Audio:** none; on-screen captions carry the narration so the video works muted (Web Store and social autoplay are muted).

**Recording:** `npm run build && npm run promo:video` runs `scripts/promo/record-demo.js`, which performs every action below in order with the caption shown in the lower third. Timings are approximate; the recorder holds each scene long enough to read its caption.

**Setting:** a fictional demo store, `shop.example.com`, in a Chrome window with DevTools docked at the bottom and the APQ Debugger panel open. All traffic is synthetic and every name, hash and URL is invented. The panel itself is the real extension UI.

**Cursor:** a visible pointer moves to each target before it is clicked, so viewers can follow the action without narration.

---

## Scene 1 · Title (0:00–0:05)

- **Screen:** title card over the dimmed browser frame. App icon, "APQ Debugger", line: "See the GraphQL behind every persisted-query hash."
- **Caption:** none.

## Scene 2 · The problem (0:05–0:13)

- **Screen:** the demo store with DevTools docked. A request-payload callout appears over the page: `{"operationName":"ProductListing","extensions":{"persistedQuery":{"sha256Hash":"7a1f0c2e…"}}}`.
- **Caption:** "Apollo's Automatic Persisted Queries send a SHA-256 hash, not the query. The Network panel can't show you what ran."

## Scene 3 · Set a pattern (0:13–0:21)

- **Action:** on first run the **Patterns** pane is already open (no pattern is saved yet). Click the pattern field and type `*graphql*`.
- **Caption:** "Tell APQ Debugger which requests to watch."

## Scene 4 · Start (0:21–0:27)

- **Action:** click **Start**. The yellow live bar appears ("Intercepting requests matching `*graphql*`") with its one-time note about Chrome's own "started debugging" bar, which Chrome also shows at the top of the window; the toolbar icon badge turns **ON**. Click **Got it** to dismiss the note, then click **Patterns** to fold the pane away and give the list room.
- **Caption:** "Press Start (Ctrl+E). The bar stays up whenever requests are being rewritten."

## Scene 5 · Browse and watch hashes resolve (0:27–0:38)

- **Action:** click **Outerwear** in the store. Hash-only rows arrive as **Awaiting retry**; a moment later each retry lands and its row flips to **Resolved** with a flash. A telemetry hash from a server without APQ fallback stays **Awaiting retry**. Then click **Add** on a product: the cart mutation arrives as a plain **Full query**, and the cart refresh resolves like the others.
- **Caption:** "Each hash is swapped, the server asks for the full query, and Apollo retries. The row resolves in place."

## Scene 6 · Read the query (0:38–0:48)

- **Action:** click the **ProductListing** resolved row. The detail pane shows the formatted, highlighted query. Click **Copy** on the query; then click the **Variables** link.
- **Caption:** "Open any operation to read and copy the full query and its variables."

## Scene 7 · Copy as cURL (0:48–1:00)

- **Action:** click **Copy as cURL** in the detail pane. The dialog opens on the **Bash** command, built from the captured URL, the operation body and the request headers captured from the page. Click **PowerShell** to show the `Invoke-RestMethod` form, click **Copy** (it reads "Copied"), then close the dialog.
- **Caption:** "Copy as cURL to replay it from a terminal, with the headers captured from the page."

## Scene 8 · Find things fast (1:00–1:06)

- **Action:** click the filter, type `Cart`; then clear it and click the **APQ** type filter, then **All**.
- **Caption:** "Filter by name, URL or request type."

## Scene 9 · Browse the schema (1:06–1:14)

- **Action:** click the **Schema** tab, click **Load schema**, then click the `Product` type in the list.
- **Caption:** "Load the schema by introspection, reusing the headers from live traffic."

## Scene 10 · Stop (1:14–1:21)

- **Action:** click the **Requests** tab, then **Stop**. The live bar disappears, the badge turns **OFF**, and a recap toast reads how many hashes resolved.
- **Caption:** "Stop when you're done. Everything stays local to your browser."

## Scene 11 · End card (1:21–1:27)

- **Screen:** end card: app icon, "APQ Debugger", "A Chrome DevTools panel for Apollo APQ".
- **Caption:** none.

---

## Rules for re-shooting

- Keep claims factual: no user counts, ratings, prices or "free" claims unless they are true at the time of publishing.
- Use only `example.com` hosts in demo traffic. Never show a real company's domain or data.
- If the panel UI changes, re-record. The video must match the shipped extension.
