import { CONSENT_VERSION } from "../lib/config.js";
import { getState, setState } from "../lib/state.js";

const result = document.getElementById("result");
const ACCESS = { permissions: ["webRequest"], origins: ["<all_urls>"] };

async function saveConsent(fullAccess) {
  const state = await getState();
  await setState({
    consentGranted: true,
    consentVersion: CONSENT_VERSION,
    consentAt: new Date().toISOString(),
    fullAccess,
    installId: state.installId ?? crypto.randomUUID(), // random, not tied to you
    paused: false,
  });
}

// Chrome only shows its permission prompt when this runs straight from a click.
document.getElementById("allow-full").addEventListener("click", async () => {
  let granted = false;
  try {
    granted = await chrome.permissions.request(ACCESS);
  } catch (e) {
    console.warn("Permission request failed:", e);
  }
  await saveConsent(granted);
  result.textContent = granted
    ? "Recording is on, with tracker detection. You can pause it from the toolbar icon. You can close this tab."
    : "Chrome's access wasn't granted, so only site names are recorded. You can try again from this page.";
});

document.getElementById("allow-basic").addEventListener("click", async () => {
  try {
    await chrome.permissions.remove(ACCESS); // drop any access granted earlier
  } catch { /* nothing to remove */ }
  await saveConsent(false);
  result.textContent = "Recording is on, for site names only. You can close this tab.";
});

document.getElementById("decline").addEventListener("click", async () => {
  try {
    await chrome.permissions.remove(ACCESS);
  } catch { /* nothing to remove */ }
  await setState({ consentGranted: false, fullAccess: false });
  result.textContent = "Nothing will be recorded. You can change your mind from the toolbar icon.";
});
