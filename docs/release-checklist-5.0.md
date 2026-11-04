# Release checklist: 5.0 (opt-in analytics)

Owner steps to ship the GraphQL Debugger 5.0 release with opt-in usage analytics.

## 1. Create the GA4 property and secrets

- [ ] In Google Analytics, create a GA4 property and a Web data stream. Copy the **Measurement ID** (`G-XXXXXXXXXX`).
- [ ] GA Admin -> Data streams -> your stream -> Measurement Protocol API secrets -> Create. Copy the secret value.
- [ ] In the GitHub repo, Settings -> Secrets and variables -> Actions, add `GA_MEASUREMENT_ID` and `GA_API_SECRET`.
- [ ] Confirm the release workflow passes both to the build step as environment variables. They are never committed; empty values mean analytics is fully off in that build.

## 2. Verify one event locally

- [ ] Build locally with both variables set (`GA_MEASUREMENT_ID=G-... GA_API_SECRET=... npm run build`) and load `extension_build/` unpacked.
- [ ] Validate the payload shape: temporarily change `GA_ENDPOINT` in `js/shared/constants.js` to `https://www.google-analytics.com/debug/mp/collect`, rebuild, accept the notice, and inspect the service worker's network request response. An empty `validationMessages` array means GA accepted the hit. (The debug endpoint only validates; it does not record the event.)
- [ ] Confirm the event in GA DebugView: DebugView only shows hits flagged with `debug_mode`, which the extension does not set. Either check GA Admin -> Reports -> Realtime with the normal endpoint against a throwaway/test property, or temporarily add `debug_mode: 1` to the event params locally (do not commit).
- [ ] Toggle analytics off in the panel settings and confirm no further requests go to `google-analytics.com` and the install ID is gone from `chrome.storage.local`.
- [ ] Revert every temporary local change before building the release.

## 3. What to expect in GA (read before judging the data)

Measurement Protocol hits are not browser page views, so GA behaves differently from a website:

- **No demographics.** Google signals data (age, gender, interests) is not populated for Measurement Protocol hits.
- **Country/region may be empty.** Geographic data is not guaranteed for MP hits. Verify it in DebugView/Realtime rather than assuming it will appear.
- **What you do get:** feature usage counts (the events in the privacy policy), extension version, Chrome major version, OS and UI language. To see the user properties (`extension_version`, `browser_major`, `os`, `ui_language`) in reports, register them as custom dimensions (user scope) in GA Admin -> Custom definitions.
- Only users who opt in are counted, so treat the numbers as a floor, not total usage.

## 4. Chrome Web Store dashboard

- [ ] Privacy practices tab: **Web history: no**. **User activity: yes** (anonymous feature usage, opt-in only). Do not declare personal data, health, financial, authentication, location, or website content collection.
- [ ] Certify the limited-use disclosures (data is used only to improve the extension, not sold or used for unrelated purposes).
- [ ] Make sure the privacy policy URL points to the published `store/privacy-policy.md` (updated 2026-11-04).
- [ ] Update the listing name, title and description from `store/store-description.md` (its Privacy paragraph now mentions opt-in analytics).
- [ ] Update the host permission justification from `store/permissions-justification.md`.
- [ ] Upload the new screenshots, promo tiles and video (`npm run promo:screens`, `npm run promo:video`).

## 5. Release

- [ ] `npm test` and `npm run lint` pass on `trunk`.
- [ ] `npm version major` (syncs `manifest.json`).
- [ ] `git push --follow-tags`, then confirm the release workflow publishes the zip.
- [ ] Install the released zip and confirm the consent notice appears once.
