import { CONSENT_VERSION } from "./config.js";

export const DEFAULTS = {
  consentGranted: false,
  consentVersion: 0,
  consentAt: null,
  fullAccess: false, // true = user also allowed tracker detection (all-sites access)
  installId: null, // random UUIDv4, created when consent is given
  paused: false,
  queue: [],
};

export async function getState() {
  return chrome.storage.local.get(DEFAULTS);
}

export async function setState(patch) {
  await chrome.storage.local.set(patch);
}

export function hasValidConsent(state) {
  return (
    state.consentGranted === true &&
    state.consentVersion === CONSENT_VERSION &&
    typeof state.installId === "string" &&
    state.installId.length > 0
  );
}

export function isRecording(state) {
  return hasValidConsent(state) && !state.paused;
}

/** Tracker detection needs both the user's choice and Chrome's permission. */
export function detectsTrackers(state) {
  return isRecording(state) && state.fullAccess === true;
}
