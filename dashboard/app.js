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
  if (text !== undefined) node.textContent = text; // textContent only: site names are never parsed as HTML
  return node;
}

function showEmpty(title, text) {
  $("list").replaceChildren();
  $("empty-title").textContent = title;
  $("empty-text").textContent = text;
  $("empty").hidden = false;
}

// ---- rendering ------------------------------------------------------------
function render(scans) {
  if (scans.length === 0) {
    $("status").textContent = "No visits recorded yet.";
    showEmpty("Nothing here yet", "Open any website in Chrome. It appears here within a few seconds.");
    return;
  }
  $("empty").hidden = true;

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
    heading.append(el("span", "count", `${items.length} ${items.length === 1 ? "visit" : "visits"}`));
    section.append(heading);

    const list = el("ul");
    for (const { scan, when } of items) {
      const row = el("li");
      row.append(el("span", "domain", scan.domain));
      row.append(el("span", scan.https ? "tag https" : "tag http", scan.https ? "HTTPS" : "No HTTPS"));
      const time = el("time", null, when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      time.dateTime = scan.observed_at;
      row.append(time);
      list.append(row);
    }
    section.append(list);
    sections.push(section);
  }
  $("list").replaceChildren(...sections);

  const updated = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("status").textContent = `${scans.length} recent ${scans.length === 1 ? "visit" : "visits"}. Updated ${updated}.`;
}

// ---- data -----------------------------------------------------------------
async function load() {
  if (!installId) {
    $("status").textContent = "This page doesn't know which install to show.";
    showEmpty("Open the dashboard from the extension", "Click the Invisible to Visible icon in Chrome's toolbar, then choose Open dashboard.");
    return;
  }
  try {
    const res = await fetch("/api/v1/scans?limit=300", { headers: { "X-Install-ID": installId } });
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
    const res = await fetch("/api/v1/me", { method: "DELETE", headers: { "X-Install-ID": installId } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { deleted_scans: n } = await res.json();
    await load();
    $("status").textContent = `Deleted ${n} ${n === 1 ? "visit" : "visits"}.`;
  } catch {
    $("status").textContent = "Couldn't delete. Is the local server running?";
  }
});

load();
setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
