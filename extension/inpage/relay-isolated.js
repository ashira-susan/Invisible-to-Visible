// Runs in the extension's own (ISOLATED) world in every frame. It is the only bridge
// between the page world (hooks-main.js) and the extension's service worker.
//
// Anything arriving here came from the web page and is untrusted: a page can dispatch
// the same event as our hooks. So the relay accepts one fixed shape, clamps every
// number, drops unusable cookie names, and sends at most one message per tick however
// many events arrive. The service worker validates again; it never trusts this either.
//
// Cookie names are passed on as they are (the service worker hashes them with the
// frame's real host the moment they arrive). They are never stored or logged here.
// Plain script (not a module): Chrome injects it as a file.
(() => {
  "use strict";

  const EVENT = "itv:inpage:v1"; // must match inpage/hooks-main.js
  const TYPE = "itv-inpage";
  const TICK_MS = 500; // at most one message per frame per tick
  const MAX_DETAIL_LENGTH = 8_192;
  const MAX_BATCH_COUNT = 1_000;
  const MAX_NAMES_PER_MESSAGE = 25;
  const MAX_NAMES_QUEUED = 200;
  const MAX_NAMES_PER_FRAME = 200; // lifetime of this frame
  const MAX_NAME_LENGTH = 128;
  const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
  const FIELDS = ["canvas", "webgl", "audio", "font", "geo"];

  const acc = { canvas: 0, webgl: 0, audio: 0, font: 0, geo: 0 };
  let queue = [];
  let forwardedNames = 0;
  let timer = null;

  function clampCount(value) {
    return Number.isInteger(value) && value > 0 ? Math.min(value, MAX_BATCH_COUNT) : 0;
  }

  function usable(name) {
    return typeof name === "string" && name.length > 0 && name.length <= MAX_NAME_LENGTH && !CONTROL_CHARS.test(name);
  }

  function onEvent(event) {
    try {
      const detail = event && event.detail;
      if (typeof detail !== "string" || detail.length > MAX_DETAIL_LENGTH) return;
      const data = JSON.parse(detail);
      if (data === null || typeof data !== "object" || Array.isArray(data)) return;
      if (data.type !== TYPE || data.v !== 1) return;

      for (const field of FIELDS) {
        acc[field] = Math.min(acc[field] + clampCount(data[field]), MAX_BATCH_COUNT);
      }
      if (Array.isArray(data.cookies)) {
        for (const name of data.cookies.slice(0, MAX_NAMES_PER_MESSAGE)) {
          if (queue.length >= MAX_NAMES_QUEUED || forwardedNames + queue.length >= MAX_NAMES_PER_FRAME) break;
          if (usable(name)) queue.push(name);
        }
      }
      schedule();
    } catch { /* a bad event is ignored */ }
  }

  function schedule() {
    if (timer === null) timer = setTimeout(send, TICK_MS);
  }

  function send() {
    timer = null;
    try {
      const names = queue.splice(0, MAX_NAMES_PER_MESSAGE);
      forwardedNames += names.length;
      const total = FIELDS.reduce((sum, field) => sum + acc[field], 0);
      if (total === 0 && names.length === 0) return;

      const message = {
        type: TYPE,
        v: 1,
        canvas: acc.canvas,
        webgl: acc.webgl,
        audio: acc.audio,
        font: acc.font,
        geo: acc.geo,
        cookies: names,
      };
      for (const field of FIELDS) acc[field] = 0;

      const sent = chrome.runtime.sendMessage(message);
      if (sent && typeof sent.catch === "function") sent.catch(() => {}); // worker gone or extension reloaded
      if (queue.length > 0) schedule();
    } catch { /* extension context invalidated, for example after a reload */ }
  }

  window.addEventListener(EVENT, onEvent);
  window.addEventListener("pagehide", () => {
    if (timer !== null) clearTimeout(timer);
    send();
  });
})();
