"use strict";

const STORAGE_KEY = "itv.installId";
const REFRESH_MS = 5000;
const $ = (id) => document.getElementById(id);

// ---- install id -----------------------------------------------------------
// The extension opens this page as /app/#install=<uuid>. We keep the id in
// localStorage and remove it from the address bar. The part after # is never
// sent to the server.
function readInstallId() {
  const match = /(?:^|[#&])install=([0-9a-f-]{36})(?:&|$)/i.exec(location.hash);
  if (match) {
    const id = match[1].toLowerCase();
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* storage blocked */ }
    history.replaceState(null, "", location.pathname + location.search);
    return id;
  }
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

const installId = readInstallId();
const openIds = new Set();      // visits the user has expanded
const detailCache = new Map();  // id -> detail from the server
let lastSignature = "";

// ---- helpers --------------------------------------------------------------
function dayKey(date) { return date.toLocaleDateString("en-CA"); } // YYYY-MM-DD in local time

function dayLabel(key) {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(yesterday)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // textContent only: names from the network are never parsed as HTML
  return node;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function showEmpty(title, text) {
  $("list").replaceChildren();
  $("empty-title").textContent = title;
  $("empty-text").textContent = text;
  $("empty").hidden = false;
}

function headers() { return { "X-Install-ID": installId }; }

// ---- one visit ------------------------------------------------------------
function trackerTag(scan) {
  if (!scan.trackers_checked) return el("span", "tag muted", "Trackers not checked");
  if (scan.tracker_count === 0) return el("span", "tag https", "No known trackers");
  return el("span", "tag http", plural(scan.tracker_count, "tracker", "trackers"));
}

async function fillDetail(body, scan) {
  if (body.dataset.loaded === "1") return;
  body.dataset.loaded = "1";
  body.textContent = "Loading…";
  try {
    let detail = detailCache.get(scan.id);
    if (!detail) {
      const res = await fetch(`/api/v1/scans/${scan.id}`, { headers: headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      detail = await res.json();
      detailCache.set(scan.id, detail);
    }
    body.replaceChildren(...detailNodes(detail));
  } catch {
    body.dataset.loaded = "0";
    body.textContent = "Couldn't load the details. Is the local server running?";
  }
}

function cookieSentence(c) {
  const total = c.first_party + c.third_party;
  if (total === 0) return "No cookies were observed being set during this visit.";
  const parts = [`${c.first_party} by the site itself`, `${c.third_party} by other sites`];
  const tracker = c.by_trackers > 0 ? ` (${c.by_trackers} of those by known trackers)` : "";
  return `${plural(total, "cookie was", "cookies were")} set during this visit (by the site's responses or its scripts): ${parts.join(", ")}${tracker}.`;
}

function inpageSentence(s) {
  // Zero counts are only "nothing observed" if the page scripts actually ran in this page.
  if (!s.inpage_checked) {
    return "Page-script calls (canvas, WebGL, audio, font measuring, location) weren't checked for this visit: the page was already open when the page scripts became active, or they didn't run. That doesn't mean there were none.";
  }
  const f = s.fingerprinting;
  const parts = [];
  if (f.canvas > 0) parts.push(plural(f.canvas, "canvas read-back", "canvas read-backs"));
  if (f.webgl > 0) parts.push(plural(f.webgl, "WebGL graphics-card query or pixel read", "WebGL graphics-card queries or pixel reads"));
  if (f.audio > 0) parts.push(plural(f.audio, "offline audio render", "offline audio renders"));
  if (f.font > 0) parts.push(plural(f.font, "burst of font measuring", "bursts of font measuring"));
  if (s.geolocation_calls > 0) parts.push(plural(s.geolocation_calls, "location request", "location requests"));
  if (parts.length === 0) return "No canvas, WebGL, audio, font-measuring or location calls were observed during this visit.";
  return `Calls observed during this visit: ${parts.join(", ")}. A call is not proof of tracking: many sites use these for ordinary features.`;
}

function detailNodes(detail) {
  const s = detail.signals;
  if (!s.trackers_checked) {
    return [el("p", null, "Trackers, cookies and the referring site weren't checked for this visit, because only site names were allowed. That doesn't mean there was nothing to find.")];
  }
  const nodes = [
    el("p", null, detail.referrer_origin ? `Arrived from ${detail.referrer_origin}.` : "No referring site: a typed address, a bookmark, or a site that hides it."),
    el("p", null, `${plural(s.third_party_requests, "request", "requests")} to other sites.`),
    el("p", null, cookieSentence(s.cookies)),
    el("p", null, inpageSentence(s)),
    el("p", "muted", "Page-script counts come from a script running inside the page, so they are best-effort: a page can inflate, hide or evade them, and they only cover pages loaded after that script was active."),
  ];
  if (s.trackers.length === 0) {
    nodes.push(el("p", "muted", "None of the sites contacted are on the list of known trackers. Unknown trackers can still exist."));
    return nodes;
  }
  nodes.push(el("p", null, `${plural(s.trackers.length, "known tracker", "known trackers")}:`));
  const list = el("ul", "trackers");
  for (const t of s.trackers) {
    const row = el("li");
    row.append(el("span", "tracker-domain", t.domain));
    const what = [t.category, t.company].filter(Boolean).join(" · ");
    row.append(el("span", "muted", what));
    if (t.known_fingerprinter) row.append(el("span", "tag http", "known fingerprinter"));
    list.append(row);
  }
  nodes.push(list);
  return nodes;
}

function visitRow(scan, when) {
  const details = el("details", "visit");
  const summary = el("summary");
  summary.append(el("span", "domain", scan.domain));

  const tags = el("span", "tags");
  tags.append(el("span", scan.https ? "tag https" : "tag http", scan.https ? "HTTPS" : "No HTTPS"));
  tags.append(trackerTag(scan));
  if (scan.trackers_checked && scan.third_party_cookies > 0) {
    tags.append(el("span", "tag muted", plural(scan.third_party_cookies, "third-party cookie", "third-party cookies")));
  }
  summary.append(tags);

  const time = el("time", null, when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  time.dateTime = scan.observed_at;
  summary.append(time);

  const body = el("div", "detail");
  details.append(summary, body);

  details.addEventListener("toggle", () => {
    if (details.open) { openIds.add(scan.id); fillDetail(body, scan); }
    else openIds.delete(scan.id);
  });
  if (openIds.has(scan.id)) details.open = true;

  const li = el("li");
  li.append(details);
  return li;
}

// ---- rendering ------------------------------------------------------------
function render(scans) {
  const updated = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (scans.length === 0) {
    lastSignature = "";
    $("status").textContent = "No visits recorded yet.";
    showEmpty("Nothing here yet", "Open any website in Chrome. It appears here about ten seconds after the page loads.");
    return;
  }
  $("status").textContent = `${plural(scans.length, "recent visit", "recent visits")}. Updated ${updated}.`;
  $("empty").hidden = true;

  // Don't rebuild the list (and collapse open rows) when nothing new has arrived.
  const signature = scans.map((s) => s.id).join(",");
  if (signature === lastSignature) return;
  lastSignature = signature;

  const groups = new Map();
  for (const scan of scans) {
    const when = new Date(scan.observed_at);
    const key = dayKey(when);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ scan, when });
  }

  const sections = [];
  for (const [key, items] of groups) {
    const section = el("section", "day");
    const heading = el("h2", null, dayLabel(key));
    heading.append(el("span", "count", plural(items.length, "visit", "visits")));
    section.append(heading);

    const list = el("ul");
    for (const { scan, when } of items) list.append(visitRow(scan, when));
    section.append(list);
    sections.push(section);
  }
  $("list").replaceChildren(...sections);
}

// ---- data -----------------------------------------------------------------
async function load() {
  if (!installId) {
    $("status").textContent = "This page doesn't know which install to show.";
    showEmpty("Open the dashboard from the extension", "Click the Invisible to Visible icon in Chrome's toolbar, then choose Open dashboard.");
    return;
  }
  try {
    const res = await fetch("/api/v1/scans?limit=300", { headers: headers() });
    if (res.status === 400 || res.status === 401) {
      $("status").textContent = "The server didn't accept this install ID.";
      showEmpty("Open the dashboard from the extension", "Click the toolbar icon, then choose Open dashboard, to get a fresh link.");
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render((await res.json()).scans);
  } catch {
    $("status").textContent = "Can't reach the local server. Start it from the backend folder: python -m uvicorn itv.main:app --reload";
  }
}

$("delete").addEventListener("click", async () => {
  if (!installId) return;
  if (!confirm("Delete every visit stored for this install? This can't be undone.")) return;
  try {
    const res = await fetch("/api/v1/me", { method: "DELETE", headers: headers() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { deleted_scans: n } = await res.json();
    openIds.clear();
    detailCache.clear();
    await load();
    $("status").textContent = `Deleted ${plural(n, "visit", "visits")}.`;
  } catch {
    $("status").textContent = "Couldn't delete. Is the local server running?";
  }
});

load();
setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
