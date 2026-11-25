// What the page-world hooks (inpage/hooks-main.js) tell the service worker, and how
// much of it we are willing to believe.
//
// Everything that starts in a web page is untrusted: a hostile page can dispatch the
// same events our hooks do. So this module accepts only a small, fixed shape, clamps
// every number, and ignores every field it does not know. Notably there is NO host
// field: the service worker works out which site a message came from by itself
// (from sender.url), never from the message.

export const INPAGE_TYPE = "itv-inpage";
export const INPAGE_VERSION = 1;

export const MAX_BATCH_COUNT = 1_000; // per field, per message
export const MAX_NAMES = 25; // cookie names per message
export const MAX_NAME_LENGTH = 128;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** A cookie name we are willing to hash: a short string without control characters. */
export function isUsableCookieName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= MAX_NAME_LENGTH && !CONTROL_CHARS.test(name);
}

function count(value) {
  if (!Number.isInteger(value) || value <= 0) return 0;
  return Math.min(value, MAX_BATCH_COUNT);
}

/**
 * Returns a clean { fingerprinting: {canvas, webgl, audio, font}, geolocation, names }
 * or null when the message is not ours, malformed, or reports nothing.
 * Unknown fields (for example a made-up "host") are dropped on purpose.
 */
export function sanitizeInpage(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.type !== INPAGE_TYPE || raw.v !== INPAGE_VERSION) return null;

  const fingerprinting = {
    canvas: count(raw.canvas),
    webgl: count(raw.webgl),
    audio: count(raw.audio),
    font: count(raw.font),
  };
  const geolocation = count(raw.geo);

  const names = [];
  if (Array.isArray(raw.cookies)) {
    for (const name of raw.cookies.slice(0, MAX_NAMES)) {
      if (isUsableCookieName(name)) names.push(name);
    }
  }

  const total = fingerprinting.canvas + fingerprinting.webgl + fingerprinting.audio + fingerprinting.font + geolocation;
  if (total === 0 && names.length === 0) return null;
  return { fingerprinting, geolocation, names };
}

/**
 * True for the relay's one-line "the page scripts ran in this top frame" message
 * ({ type, v, hb: 1 }). It carries no data. The service worker only believes it from the
 * top frame (sender.frameId 0) and only when sender.documentId is the page's own document.
 */
export function isHeartbeat(raw) {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) && raw.type === INPAGE_TYPE && raw.v === INPAGE_VERSION && raw.hb === 1;
}

/**
 * Decides whether a runtime message may be looked at, and what we take from the sender.
 * Chrome fills in `sender`; the message body is never consulted for any of this.
 * Returns { tabId, frameId, url, documentId } or null. documentId is null when Chrome
 * gave none.
 */
export function acceptSender(sender, extensionId) {
  if (!sender || typeof extensionId !== "string" || sender.id !== extensionId) return null; // not our own extension
  const tab = sender.tab;
  if (!tab || !Number.isInteger(tab.id) || tab.id < 0) return null; // not from a real tab
  return {
    tabId: tab.id,
    frameId: Number.isInteger(sender.frameId) && sender.frameId >= 0 ? sender.frameId : 0,
    url: typeof sender.url === "string" ? sender.url : "",
    documentId: typeof sender.documentId === "string" && sender.documentId !== "" ? sender.documentId : null,
  };
}
