import { PublicSuffixList } from "./lib/psl.js";
import { TrackerList } from "./lib/trackers.js";
import { PageSessions } from "./lib/page-sessions.js";
import { buildSummary } from "./lib/summary.js";
import { sendOrQueue } from "./lib/api.js";
import { getState, isRecording, detectsTrackers } from "./lib/state.js";

let state = null;
let sessions = null;

const sessionStore = {
  async get() {
    const { pages } = await chrome.storage.session.get({ pages: {} });
    return pages;
  },
  async set(pages) {
    await chrome.storage.session.set({ pages });
  },
};

async function loadAsset(path, kind) {
  const res = await fetch(chrome.runtime.getURL(path));
  return kind === "json" ? res.json() : res.text();
}

// Everything that needs data waits for this. The service worker can be stopped and
// restarted by Chrome at any time, so it is rebuilt from storage on every start.
const ready = (async () => {
  const [pslText, trackerData, saved] = await Promise.all([
    loadAsset("data/public_suffix_list.dat", "text"),
    loadAsset("data/trackers.json", "json"),
    getState(),
  ]);
  state = saved;
  sessions = new PageSessions({
    psl: new PublicSuffixList(pslText),
    trackers: new TrackerList(trackerData),
    store: sessionStore,
    onFinalize: sendFinishedPage,
  });
  await sessions.load();
  await sessions.finalizeStale();
})();

// A page's visit is over: build the small summary and send it (or queue it).
async function sendFinishedPage(page) {
  state = await getState(); // the user may have paused or changed consent meanwhile
  if (!isRecording(state)) return;
  const signals = detectsTrackers(state) ? PageSessions.toSignals(page) : {};
  const summary = buildSummary({ domain: page.host, https: page.https }, new Date(page.startedAt), signals);
  await sendOrQueue(state.installId, summary);
}

// ---- listeners (must be registered synchronously, every time the worker starts) ----

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("consent/consent.html") });
  }
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") getState().then((s) => (state = s));
});

// A top-level page was committed (after any redirects).
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  await ready;
  if (!isRecording(state)) {
    await sessions.finalize(details.tabId);
    return;
  }
  await sessions.start(details.tabId, details.url);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  await sessions.closeTab(tabId);
});

// Safety net: if the worker was stopped before a page settled, finish it later.
chrome.alarms.get("sweep", (alarm) => {
  if (!alarm) chrome.alarms.create("sweep", { periodInMinutes: 0.5 });
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "sweep") return;
  await ready;
  await sessions.finalizeStale();
});

// Only exists once the user has granted the optional "all sites" access.
let watchingRequests = false;
function watchRequests() {
  if (watchingRequests || !chrome.webRequest) return;
  chrome.webRequest.onBeforeRequest.addListener(
    async (details) => {
      if (details.tabId < 0 || details.type === "main_frame") return;
      await ready;
      if (!detectsTrackers(state)) return;
      sessions.addRequest(details.tabId, details.url); // only the host is used; the address is not stored
    },
    { urls: ["<all_urls>"] }, // observe only: nothing is blocked or changed
  );
  watchingRequests = true;
}
watchRequests();
chrome.permissions.onAdded.addListener(watchRequests);
