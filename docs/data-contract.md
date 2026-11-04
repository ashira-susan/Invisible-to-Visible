# Data contract v1

The agreement between the browser extension (which observes) and the backend (which stores and scores).
**Source of truth:** `backend/itv/schemas.py`. The JSON Schema in `docs/schemas/` is generated from it
(`cd backend && python tools/export_schema.py`). If this document and the code disagree, the code wins and this file is wrong.

## Principles

1. **Summaries, not raw data.** The extension reduces what it sees on the device and sends only the summary below.
2. **Strict by default.** Unknown fields are rejected. A URL, page title or cookie value cannot be sent by accident, because the backend answers `422`.
3. **Identity is a header, not data.** Each install has a random UUIDv4, sent as `X-Install-ID`. It is not derived from the person or the machine.
4. **Missing means zero, except for `trackers_checked`.** Everything under `signals` is optional. A missing count means none were seen. But `signals.trackers_checked` says whether anyone was looking: `false` means the user only allowed site names, so an empty tracker list is *unknown*, not *clean*.
5. **Evolving.** Adding an optional field stays on `schema_version: "1"`. Renaming, removing or changing the meaning of a field means `"2"`.

## Requests

| Method and path | Header | Purpose |
|---|---|---|
| `POST /api/v1/scans` | `X-Install-ID` | Store one page visit (body below). Returns `201 {id, domain}`. |
| `GET /api/v1/scans?limit=100` | `X-Install-ID` | This install's visits, newest first (limit 1 to 500), with `third_party_requests`, `tracker_count` and `trackers_checked` for each. |
| `GET /api/v1/scans/{id}` | `X-Install-ID` | One visit with its full `signals`. `404` if it is not yours (indistinguishable from missing). |
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
| `site.referrer_origin` | string or null | no | origin only, such as `https://www.google.com`; never a path | M2b |
| `signals.trackers_checked` | boolean | no | `true` when tracker detection was on for this visit; default `false` | M2a |
| `signals.third_party_requests` | integer | no | requests to other sites (a different registrable domain than the page), 0 to 100000 | M2a |
| `signals.trackers[]` | object | no | known trackers contacted, at most 200, one entry per tracker domain | M2a |
| `signals.trackers[].domain` | string | yes | the listed tracker domain (`doubleclick.net`), not the exact subdomain requested | M2a |
| `signals.trackers[].category` | string | no | `advertising`, `analytics`, `social`, `fingerprinting`, `content` or `other`; default `other`. The main purpose wins over fingerprinting. | M2a |
| `signals.trackers[].company` | string or null | no | owning company from the tracker list, 1 to 100 characters | M2a |
| `signals.trackers[].known_fingerprinter` | boolean | no | the tracker list also marks it as using fingerprinting; default `false` | M2a |
| `signals.cookies.first_party` / `.third_party` | integer | no | counts only, never names or values | M2c |
| `signals.fingerprinting.canvas` / `.webgl` / `.audio` / `.font` | integer | no | number of suspicious calls observed | M2c |
| `signals.geolocation_calls` | integer | no | calls to the browser location API | M2c |

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
4. About 10 seconds after the page loads, when you leave the page, or when the tab closes (whichever is first), the summary is sent. Trackers that appear later are not counted.

Tracker detection needs the user's choice (`fullAccess`) **and** Chrome's all-sites access. Without either, visits are sent with `trackers_checked: false`.

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
