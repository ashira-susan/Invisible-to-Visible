import { CONSENT_VERSION } from "../lib/config.js";
import { getState, setState } from "../lib/state.js";

const result = document.getElementById("result");

document.getElementById("allow").addEventListener("click", async () => {
  const state = await getState();
  await setState({
    consentGranted: true,
    consentVersion: CONSENT_VERSION,
    consentAt: new Date().toISOString(),
    installId: state.installId ?? crypto.randomUUID(), // random, not tied to you
    paused: false,
  });
  result.textContent = "Recording is on. You can pause it from the toolbar icon. You can close this tab.";
});

document.getElementById("decline").addEventListener("click", async () => {
  await setState({ consentGranted: false });
  result.textContent = "Nothing will be recorded. You can change your mind from the toolbar icon.";
});
