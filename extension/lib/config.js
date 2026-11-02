// The backend runs on this computer only. Change the port here if you change it in uvicorn.
export const API_BASE = "http://127.0.0.1:8000";

// Bump this whenever the extension starts collecting something new.
// Everyone is then asked to consent again before the new collection begins.
export const CONSENT_VERSION = 1;

// Page visits waiting to be sent while the backend is offline.
export const QUEUE_LIMIT = 200;
