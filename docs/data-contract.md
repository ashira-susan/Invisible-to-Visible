# Data contract v1

The agreement between the browser extension (which observes) and the backend (which stores and scores).
**Source of truth:** `backend/itv/schemas.py`. The JSON Schema in `docs/schemas/` is generated from it
(`cd backend && python tools/export_schema.py`). If this document and the code disagree, the code wins and this file is wrong.

## Principles

1. **Summaries, not raw data.** The extension reduces what it sees on the device and sends only the summary below.
2. **Strict by default.** Unknown fields are rejected. A URL, page title or cookie value cannot be sent by accident, because the backend answers `422`.
3. **Identity is a header, not data.** Each install has a random UUIDv4, sent as `X-Install-ID`. It is not derived from the person or the machine.
4. **Missing means zero, except for `trackers_checked`.** Everything under `signals` is optional. A missing count means none were seen. But `signals.trackers_checked` says whether request monitoring was on for the visit (trackers, cookies, the referrer and the page-script counts all depend on it): `false` means the user only allowed site names, so an empty tracker list, a cookie count of zero, a missing referrer or zero page-script calls is *unknown*, not *clean*.
5. **Evolving.** Adding an optional field stays on `schema_version: "1"`. Renaming, removing or changing the meaning of a field means `"2"`.

## Requests

| Method and path | Header | Purpose |
|---|---|---|
| `POST /api/v1/scans` | `X-Install-ID` | Store one page visit (body below). Returns `201 {id, domain}`. |
| `GET /api/v1/scans?limit=100` | `X-Install-ID` | This install's visits, newest first (limit 1 to 500), with `third_party_requests`, `tracker_count`, `third_party_cookies` and `trackers_checked` for each. |
| `GET /api/v1/scans/{id}` | `X-Install-ID` | One visit with its `referrer_origin` and full `signals`. `404` if it is not yours (indistinguishable from missing). |
| `DELETE /api/v1/me` | `X-Install-ID` | Delete everything stored for this install. |
| `GET /api/v1/health` | none | `{status, version}` |

Errors: `401` header missing, `400` header is not a UUIDv4, `422` body breaks the contract.

## Body of `POST /api/v1/scans`

| Field | Type | Required | Rule | Filled by |
|---|---|---|---|---|
| `schema_version` | string | yes | exactly `"1"` | M1 |
| `observed_at` | string (ISO 8601) | yes | must include a timezone; not in the future | M1 |
| `site.domain` | string | yes | lowercase hostname only, 1 to 253 chars; no scheme, path, port, query or trailing dot | M1 |
| `site.https` | boolean | yes | page used HTTPS | M1 |
| `site.referrer_origin` | string or null | no | the site the user arrived from: origin only, such as `https://www.google.com`; never a path. `null` for typed addresses, bookmarks, the same site, or when the previous site hides it. | M2b |
| `signals.trackers_checked` | boolean | no | `true` when tracker detection was on for this visit; default `false` | M2a |
| `signals.third_party_requests` | integer | no | requests to other sites (a different registrable domain than the page), 0 to 100000 | M2a |
| `signals.trackers[]` | object | no | known trackers contacted, at most 200, one entry per tracker domain | M2a |
| `signals.trackers[].domain` | string | yes | the listed tracker domain (`doubleclick.net`), not the exact subdomain requested | M2a |
| `signals.trackers[].category` | string | no | `advertising`, `analytics`, `social`, `fingerprinting`, `content` or `other`; default `other`. The main purpose wins over fingerprinting. | M2a |
| `signals.trackers[].company` | string or null | no | owning company from the tracker list, 1 to 100 characters | M2a |
| `signals.trackers[].known_fingerprinter` | boolean | no | the tracker list also marks it as using fingerprinting; default `false` | M2a |
| `signals.cookies.first_party` / `.third_party` / `.by_trackers` | integer | no | unique cookies set during the visit, by response headers (M2b) or by page scripts (M2c); counts only, never names or values | M2b, M2c |
| `signals.fingerprinting.canvas` | integer | no | calls **observed** that read back a canvas after text was drawn on it (`toDataURL`, `toBlob`, `getImageData`, `convertToBlob`). Best effort. | M2c |
| `signals.fingerprinting.webgl` | integer | no | calls **observed** that ask for the graphics card's real vendor or renderer, or read pixels back. Best effort. | M2c |
| `signals.fingerprinting.audio` | integer | no | calls **observed** that render audio offline (`OfflineAudioContext.startRendering`, or frequency reads on an offline context). Best effort. | M2c |
| `signals.fingerprinting.font` | integer | no | **bursts** observed: at least 20 `measureText` calls, or at least 20 `document.fonts.check` calls, with at least 10 different fonts, within 1 second. Best effort. | M2c |
| `signals.geolocation_calls` | integer | no | calls **observed** to `getCurrentPosition` or `watchPosition`. Best effort. | M2c |

A call observed is not proof of tracking: many sites use canvas, WebGL, fonts or audio for ordinary features. The fields count calls; judging them is the job of the scoring in M3, which can weight them. The `fingerprinting` name is the contract's, kept from v1; the dashboard says "calls observed", never "fingerprinting detected".

### Minimal example (site names only)

```json
{
  "schema_version": "1",
  "observed_at": "2026-10-01T09:15:00Z",
  "site": { "domain": "news.example.com", "https": true }
}
```

### With tracker detection (what M2a sends)

```json
{
  "schema_version": "1",
  "observed_at": "2026-10-01T09:15:42Z",
  "site": { "domain": "news.example.com", "https": true, "referrer_origin": null },
  "signals": {
    "trackers_checked": true,
    "third_party_requests": 12,
    "trackers": [
      { "domain": "doubleclick.net", "category": "advertising", "company": "Google" }
    ]
  }
}
```

More examples, valid and invalid, live in `docs/examples/`. The tests run every one of them.

## How the extension fills in `signals` (M2a)

1. A top-level page is committed in a tab: the extension starts a record holding only the hostname and the HTTPS flag.
2. While the page loads, each request it makes to another site is looked at once: the host is compared with the page's host using the Public Suffix List. A different registrable domain counts as a third-party request, and the host is matched against the bundled tracker list.
3. Only a count and the matched tracker entries are kept. The addresses of the requests are never stored.
4. **Cookies (M2b):** each `Set-Cookie` response header is reduced on the spot to a one-way hash of "which host set which cookie name", and the value is discarded. Counting unique hashes gives the numbers in `signals.cookies`, so a cookie refreshed ten times counts once and a deletion (`Max-Age=0` or a past `Expires`) counts as nothing. The hashes stay on the device and are never sent. Cookies written by a page's own scripts are added in M2c (below).
5. **Referrer (M2b):** the `Referer` header of the page's own request is cut down to its origin straight away. It is dropped if it is the same site as the page, or older than 30 seconds.
6. About 10 seconds after the page loads, when you leave the page, or when the tab closes (whichever is first), the summary is sent. Trackers that appear later are not counted.

Tracker detection needs the user's choice (`fullAccess`) **and** Chrome's all-sites access. Without either, visits are sent with `trackers_checked: false`.

## How the extension fills in `signals` (M2c): page-world hooks

While recording is on, tracker detection is allowed and Chrome's all-sites access is granted, the extension registers two small scripts that run in every frame of every http(s) page, before the page's own scripts (including `about:blank` and `srcdoc` frames, which needs Chrome 119 or newer):

1. **`inpage/hooks-main.js`** (the page's own "MAIN" world). It wraps canvas, WebGL, audio, font-measuring, geolocation and `document.cookie` writes. Each wrapper counts first, then calls the real function, so results and errors are exactly the original's. It never reads page content, form fields or typed text, and never reads cookie values. For a cookie write it takes only the cookie's **name**, and ignores deletions.
2. **`inpage/relay-isolated.js`** (the extension's own "ISOLATED" world). It is the only bridge to the service worker. It accepts one fixed message shape, clamps every number, filters cookie names, and sends at most one message per frame every 500 ms.
3. **The service worker** accepts the message only from this extension, from a real tab, and works out the frame's site **from `sender.url`**, which Chrome supplies. The message has no host field, and anything extra a page puts in it is ignored. The worker hashes each cookie name straight away with `cookieKey(frame host, name)`, the same function used for `Set-Cookie` headers, so a cookie seen both ways is counted once. Names exist only inside these in-browser messages: they are never stored (not even in session storage), logged or sent.
4. Counts are added to the page's record and capped (100 000 per field, 2 000 cookie keys per bucket). A late message from a page the tab already left is dropped when its frame-0 host differs from the current page.

Script-set cookies from a frame with no usable host (for example `about:blank`) are dropped; its canvas, WebGL, audio, font and location counts still count toward the page, because the counts do not depend on the host.

**Page-world counts are best effort.** The scripts run in the page's own world, so a hostile page can see them, wrap them again, or undo them, and can dispatch the same event to inflate the numbers (which is why every number is clamped and rate-limited, never trusted). Other limits:

- Chrome injects registered scripts only into pages loaded **after** registration. Tabs that were already open need a reload. Until then, zeros mean "nothing observed", not "clean" (the contract has no field for "hooks were running").
- Pausing, withdrawing consent or removing Chrome's access stops new pages from being hooked and makes the service worker ignore messages at once. Pages that are already open keep their (now silent) hooks until they are reloaded.
- Cookies set through the `cookieStore` API, from workers, or with a `Domain=` attribute that differs from the frame's host can be missed or counted under another host.
- Closed shadow roots, some sandboxed frames and pages that replace the wrapped APIs before the scripts run can be missed.
- Nothing says which frame (which tracker's iframe) made a call; that is per-frame attribution and is left for M3.

## Never sent

Full URLs, paths, query strings, fragments, page titles or content, cookie names or values, form entries, keystrokes, usernames or passwords in URLs.

## Decisions

| # | Question | Status |
|---|---|---|
| D-1 | Send the full hostname or only the registrable domain? | **Decided (M2):** full hostname. Group by registrable domain later, on the backend. |
| D-2 | Which tracker list? | **Decided (M2a):** Disconnect `services.json` and `entities.json` (CC BY-NC-SA 4.0). See `THIRD_PARTY_NOTICES.md`. |
| D-3 | How long are visits kept? The plan assumes 90 days. | Open, decide in M3. |
| D-4 | When is all-sites access requested? | **Decided (M2a):** at consent time, as an optional permission, not at install. |
| D-5 | When is a visit's summary sent? | **Decided (M2a):** about 10 seconds after load, on leaving the page, or when the tab closes. |
| D-6 | How are cookies counted? | **Decided (M2b):** from `Set-Cookie` headers during the visit, de-duplicated by a one-way hash. No `cookies` permission, no names or values kept. |
| D-7 | What is kept of the referrer? | **Decided (M2b):** the origin only; dropped when it is the same site. |
| D-8 | Does this need new consent? | **Decided (M2b):** yes. Consent version 3 asks again, because new things are collected. |
| D-9 | Where are script-set cookie names hashed? | **Decided (M2c):** in the service worker, with the host taken from `sender.url`, using the same `cookieKey` as header cookies. Names travel MAIN to ISOLATED to the service worker as in-browser messages only and are never stored, logged or sent. |
| D-10 | How do script-set cookies join the counts? | **Decided (M2c):** into the same hashed buckets as header cookies. No contract change; a cookie seen both ways counts once. |
| D-11 | Where does the frame's site come from? | **Decided (M2c):** from `sender.url`, never from the message. A made-up host in a message is ignored. |
| D-12 | How far can page-world counts be trusted? | **Decided (M2c):** best effort. A hostile page can inflate or evade them; they are clamped and rate-limited, and the docs and dashboard say so. |
| D-13 | Does this need new consent? | **Decided (M2c):** yes. Consent version 4 asks again and says plainly that a small script runs inside every page you visit. |
| D-14 | What do the fingerprinting counts mean? | **Decided (M2c):** calls or bursts observed, not verdicts. Canvas counts only read-backs of a canvas that text was drawn on; fonts count bursts (20 calls, 10 fonts, 1 second); `document.fonts.check` follows the same burst rule. |
| D-15 | When do the page scripts exist? | **Decided (M2c):** only while `detectsTrackers` is true and Chrome's access is held; registration is re-synced on every worker start, install or update, change of consent, pause or access, and the scripts are removed otherwise. |
