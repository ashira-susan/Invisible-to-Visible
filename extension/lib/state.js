import { CONSENT_VERSION } from "./config.js";

export const DEFAULTS = {
  consentGranted: false,
  consentVersion: 0,
  consentAt: null,
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
