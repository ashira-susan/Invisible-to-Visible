import { API_BASE } from "../lib/config.js";
import { getState, setState, hasValidConsent } from "../lib/state.js";

const $ = (id) => document.getElementById(id);

async function render() {
  const state = await getState();
  const consented = hasValidConsent(state);

  $("open").hidden = !consented;
  $("toggle").hidden = !consented;
  $("consent").hidden = consented;

  if (!consented) {
    $("status").textContent = "Not recording. Review the consent screen to start.";
  } else if (state.paused) {
    $("status").textContent = "Paused. Nothing is being recorded.";
    $("toggle").textContent = "Resume recording";
  } else {
    $("status").textContent = "Recording site names only. Nothing leaves this computer.";
    $("toggle").textContent = "Pause recording";
  }

  const waiting = state.queue.length;
  $("queue").hidden = waiting === 0;
  $("queue").textContent = `${waiting} ${waiting === 1 ? "visit is" : "visits are"} waiting for the local server.`;
}

$("toggle").addEventListener("click", async () => {
  const state = await getState();
  await setState({ paused: !state.paused });
  await render();
});

$("open").addEventListener("click", async () => {
  const { installId } = await getState();
  // The part after # is never sent to the server; the dashboard keeps it and removes it from the address bar.
  await chrome.tabs.create({ url: `${API_BASE}/app/#install=${installId}` });
});

$("consent").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("consent/consent.html") });
});

render();
