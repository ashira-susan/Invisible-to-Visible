# Data contract v1

The agreement between the browser extension (which observes) and the backend (which stores visit summaries).
**Source of truth:** `backend/itv/schemas.py`. The JSON Schema in `docs/schemas/` is generated from it
(`cd backend && python tools/export_schema.py`). If this document and the code disagree, the code wins and this file is wrong.

## Principles

1. **Summaries, not raw data.** The extension reduces what it sees on the device and sends only the summary below.
2. **Strict by default.** Unknown fields are rejected. A URL, page title or cookie value cannot be sent by accident, because the backend answers `422`.
3. **Identity is a header, not data.** Each install has a random UUIDv4, sent as `X-Install-ID`. It is not derived from the person or the machine.
4. **Signals are optional.** M1 sends no signal data. M2 can add optional signal fields without changing the schema version.
5. **Evolving.** Adding an optional field stays on `schema_version: "1"`. Renaming, removing or changing the meaning of a field means `"2"`.

## Requests

| Method and path | Header | Purpose |
|---|---|---|
| `POST /api/v1/scans` | `X-Install-ID` | Store one page visit (body below). Returns `201 {id, domain}`. |
| `GET /api/v1/scans?limit=100` | `X-Install-ID` | This install's visits, newest first (limit 1 to 500). |
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
| `site.referrer_origin` | string or null | no | origin only, such as `https://www.google.com`; never a path | M2 |
| `signals.third_party_requests` | integer | no | 0 to 100000 | M2 |
| `signals.trackers[]` | `{domain, category}` | no | at most 200; category is `advertising`, `analytics`, `social`, `fingerprinting`, `content` or `other` | M2 |
| `signals.cookies.first_party` / `.third_party` | integer | no | counts only, never names or values | M2 |
| `signals.fingerprinting.canvas` / `.webgl` / `.audio` / `.font` | integer | no | number of suspicious calls observed | M2 |
| `signals.geolocation_calls` | integer | no | calls to the browser location API | M2 |

### Minimal example (what M1 sends)

```json
{
  "schema_version": "1",
  "observed_at": "2026-10-01T09:15:00Z",
  "site": { "domain": "news.example.com", "https": true }
}
```

More examples, valid and invalid, live in `docs/examples/`. The tests run every one of them.

## Never sent

Full URLs, paths, query strings, fragments, page titles or content, cookie names or values, form entries, keystrokes, usernames or passwords in URLs.

## Open decisions

| # | Question | Decide by |
|---|---|---|
| D-1 | Send the full hostname (`mail.google.com`) or only the registrable domain (`google.com`)? M1 sends the hostname. | M2 |
| D-2 | Tracker names come from an on-device list. Which open list, and under which licence? | M2 |
| D-3 | How long are visits kept? The plan assumes 90 days. | M3 |
