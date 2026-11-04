// The backend runs on this computer only. Change the port here if you change it in uvicorn.
export const API_BASE = "http://127.0.0.1:8000";

// Bump this whenever the extension starts collecting something new.
// Everyone is then asked to consent again before the new collection begins.
//   1 = site names only
//   2 = site names + which known tracking companies each page contacts (needs all-sites access)
export const CONSENT_VERSION = 2;

// Page visits waiting to be sent while the backend is offline.
export const QUEUE_LIMIT = 200;

// A page's summary is sent this long after it loads (or sooner if you leave the page).
export const SETTLE_MS = 10_000;
