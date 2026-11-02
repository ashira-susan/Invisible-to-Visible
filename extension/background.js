import { buildScanSummary } from "./lib/summary.js";
import { sendOrQueue } from "./lib/api.js";
import { getState, isRecording } from "./lib/state.js";

// Open the consent page the first time the extension is installed.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("consent/consent.html") });
  }
});

// A top-level page finished loading.
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return; // ignore iframes

  const state = await getState();
  if (!isRecording(state)) return; // no consent, or paused

  const summary = buildScanSummary(details.url);
  if (!summary) return;

  await sendOrQueue(state.installId, summary);
});
