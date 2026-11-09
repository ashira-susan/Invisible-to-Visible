// Runs INSIDE every page (the page's own "MAIN" world) before any of the page's scripts.
// It watches whether the page uses canvas read-back, WebGL, audio rendering, font
// measuring, the location API, or writes cookies, and counts those calls.
//
// What it never does: read page content, form fields or anything typed; read cookie
// VALUES; change what any call returns; or throw. Each wrapper counts first (inside
// try/catch) and then calls the real function, outside any try/catch, so results and
// errors are exactly the originals.
//
// A page can see and tamper with everything here, so the counts are best effort.
// Plain script (not a module): Chrome injects it as a file.
(() => {
  "use strict";

  const G = globalThis;
  const EVENT = "itv:inpage:v1"; // must match inpage/relay-isolated.js
  const TYPE = "itv-inpage";
  const FLUSH_MS = 300;
  const MAX_PENDING = 1_000_000;
  const MAX_NAMES_PER_FLUSH = 25;
  const MAX_NAMES_TOTAL = 200;
  const MAX_NAME_LENGTH = 128;

  // Font-probing burst rule: at least this many calls, with at least this many
  // different fonts, within this many milliseconds.
  const BURST_CALLS = 20;
  const BURST_DISTINCT = 10;
  const BURST_WINDOW_MS = 1_000;

  // Keep our own references to everything we rely on, so a page that replaces
  // JSON.stringify or setTimeout later cannot break or steer the hooks.
  const apply = Reflect.apply;
  const defineProperty = Object.defineProperty;
  const getOwnDescriptor = Object.getOwnPropertyDescriptor;
  const stringify = JSON.stringify;
  const dateNow = Date.now;
  const dateParse = Date.parse;
  const setTimer = G.setTimeout;
  const dispatch = G.dispatchEvent;
  const addListener = G.addEventListener;
  const CustomEventCtor = G.CustomEvent;
  const perfNow = G.performance && G.performance.now ? G.performance.now.bind(G.performance) : () => dateNow();
  const nativeToString = Function.prototype.toString;
  const SetCtor = Set;
  const WeakSetCtor = WeakSet;
  const WeakMapCtor = WeakMap;

  // ---- looking native -------------------------------------------------------
  const disguised = new WeakMapCtor(); // wrapper -> original

  function disguise(wrapper, original) {
    try {
      defineProperty(wrapper, "name", { value: original.name, configurable: true });
      defineProperty(wrapper, "length", { value: original.length, configurable: true });
    } catch { /* keep going */ }
    disguised.set(wrapper, original);
    return wrapper;
  }

  const patchedToString = {
    toString() {
      const original = disguised.get(this);
      return apply(nativeToString, original === undefined ? this : original, []);
    },
  }.toString;
  disguise(patchedToString, nativeToString);
  try {
    const d = getOwnDescriptor(Function.prototype, "toString");
    defineProperty(Function.prototype, "toString", { ...d, value: patchedToString });
  } catch { /* leave it */ }

  // ---- reporting --------------------------------------------------------------
  const counts = { canvas: 0, webgl: 0, audio: 0, font: 0, geo: 0 };
  const names = []; // cookie names not yet reported
  const seenNames = new SetCtor();
  let timer = null;

  function bump(kind) {
    try {
      if (counts[kind] < MAX_PENDING) counts[kind] += 1;
      schedule();
    } catch { /* never disturb the page */ }
  }

  function noteCookieName(name) {
    try {
      if (seenNames.size >= MAX_NAMES_TOTAL || seenNames.has(name)) return;
      seenNames.add(name);
      names.push(name);
      schedule();
    } catch { /* never disturb the page */ }
  }

  function schedule() {
    if (timer !== null || typeof setTimer !== "function") return;
    timer = apply(setTimer, G, [flush, FLUSH_MS]);
  }

  function flush() {
    timer = null;
    try {
      const batch = names.splice(0, MAX_NAMES_PER_FLUSH);
      const total = counts.canvas + counts.webgl + counts.audio + counts.font + counts.geo;
      if (total === 0 && batch.length === 0) return;
      const message = {
        type: TYPE,
        v: 1,
        canvas: counts.canvas,
        webgl: counts.webgl,
        audio: counts.audio,
        font: counts.font,
        geo: counts.geo,
        cookies: batch,
      };
      counts.canvas = counts.webgl = counts.audio = counts.font = counts.geo = 0;
      apply(dispatch, G, [new CustomEventCtor(EVENT, { detail: stringify(message) })]);
      if (names.length > 0) schedule();
    } catch { /* drop this batch rather than disturb the page */ }
  }

  try {
    if (typeof addListener === "function") {
      apply(addListener, G, ["pagehide", flush]);
    }
  } catch { /* ignore */ }

  // ---- wrapping helper --------------------------------------------------------
  // The wrapper calls `before` (guarded), then the real function (unguarded).
  function wrapMethod(target, name, before) {
    try {
      if (!target) return;
      const desc = getOwnDescriptor(target, name);
      if (!desc || typeof desc.value !== "function") return;
      const original = desc.value;
      const wrapper = {
        [name](...args) {
          try { before(this, args); } catch { /* never disturb the page */ }
          return apply(original, this, args);
        },
      }[name]; // a method definition: like the native, it cannot be used with `new`
      disguise(wrapper, original);
      defineProperty(target, name, { ...desc, value: wrapper });
    } catch { /* this API is not available here */ }
  }

  const proto = (ctor) => (typeof ctor === "function" ? ctor.prototype : null);

  // ---- canvas: reading back a canvas that text was drawn on ---------------------
  const textCanvases = new WeakSetCtor();
  const noteText = (ctx) => { const c = ctx.canvas; if (c !== null && typeof c === "object") textCanvases.add(c); };

  for (const ctor of [G.CanvasRenderingContext2D, G.OffscreenCanvasRenderingContext2D]) {
    const p = proto(ctor);
    wrapMethod(p, "fillText", noteText);
    wrapMethod(p, "strokeText", noteText);
    wrapMethod(p, "getImageData", (ctx) => { if (textCanvases.has(ctx.canvas)) bump("canvas"); });
  }
  wrapMethod(proto(G.HTMLCanvasElement), "toDataURL", (canvas) => { if (textCanvases.has(canvas)) bump("canvas"); });
  wrapMethod(proto(G.HTMLCanvasElement), "toBlob", (canvas) => { if (textCanvases.has(canvas)) bump("canvas"); });
  wrapMethod(proto(G.OffscreenCanvas), "convertToBlob", (canvas) => { if (textCanvases.has(canvas)) bump("canvas"); });

  // ---- WebGL: the graphics card's real name, and reading pixels back -------------
  const UNMASKED_VENDOR = 0x9245;
  const UNMASKED_RENDERER = 0x9246;
  for (const ctor of [G.WebGLRenderingContext, G.WebGL2RenderingContext]) {
    const p = proto(ctor);
    wrapMethod(p, "getParameter", (_gl, args) => {
      if (args[0] === UNMASKED_VENDOR || args[0] === UNMASKED_RENDERER) bump("webgl");
    });
    wrapMethod(p, "readPixels", () => bump("webgl"));
  }

  // ---- audio: rendering audio offline, the classic audio fingerprint --------------
  const isOffline = (node) => typeof G.OfflineAudioContext === "function" && node.context instanceof G.OfflineAudioContext;
  wrapMethod(proto(G.OfflineAudioContext), "startRendering", () => bump("audio"));
  wrapMethod(proto(G.AnalyserNode), "getFloatFrequencyData", (node) => { if (isOffline(node)) bump("audio"); });

  // ---- fonts: many different fonts measured or checked in a short burst ----------
  function makeBurstDetector() {
    const calls = [];
    return (font) => {
      const t = perfNow();
      calls.push({ t, font });
      while (calls.length > 0 && t - calls[0].t > BURST_WINDOW_MS) calls.shift();
      if (calls.length > 200) calls.splice(0, calls.length - 200);
      if (calls.length < BURST_CALLS) return;
      if (new SetCtor(calls.map((c) => c.font)).size >= BURST_DISTINCT) {
        calls.length = 0; // the next burst has to build up again
        bump("font");
      }
    };
  }
  const measureBurst = makeBurstDetector();
  const checkBurst = makeBurstDetector();
  for (const ctor of [G.CanvasRenderingContext2D, G.OffscreenCanvasRenderingContext2D]) {
    wrapMethod(proto(ctor), "measureText", (ctx) => measureBurst(String(ctx.font)));
  }
  wrapMethod(proto(G.FontFaceSet), "check", (_set, args) => {
    if (typeof args[0] === "string") checkBurst(args[0]);
  });

  // ---- location ------------------------------------------------------------------
  wrapMethod(proto(G.Geolocation), "getCurrentPosition", () => bump("geo"));
  wrapMethod(proto(G.Geolocation), "watchPosition", () => bump("geo"));

  // ---- cookies written by the page's own scripts ----------------------------------
  // Only the NAME of a cookie being set or refreshed is taken, and only from strings.
  // The value is never copied. Deletions (Max-Age<=0 or a past Expires) are ignored.
  function cookieNameBeingSet(text) {
    const parts = text.split(";");
    const eq = parts[0].indexOf("=");
    if (eq <= 0) return null;
    const name = parts[0].slice(0, eq).trim();
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null;

    let maxAge = null;
    let expiresMs = null;
    for (const attr of parts.slice(1)) {
      const at = attr.indexOf("=");
      const key = (at === -1 ? attr : attr.slice(0, at)).trim().toLowerCase();
      const value = at === -1 ? "" : attr.slice(at + 1).trim();
      if (key === "max-age") {
        const n = Number.parseInt(value, 10);
        if (Number.isFinite(n)) maxAge = n;
      } else if (key === "expires") {
        const t = dateParse(value);
        if (!Number.isNaN(t)) expiresMs = t;
      }
    }
    const expired = maxAge !== null ? maxAge <= 0 : expiresMs !== null && expiresMs <= dateNow();
    return expired ? null : name;
  }

  try {
    const owner = [G.Document, G.HTMLDocument].map(proto).find((p) => p && getOwnDescriptor(p, "cookie"));
    const desc = owner && getOwnDescriptor(owner, "cookie");
    if (desc && typeof desc.set === "function") {
      const originalSet = desc.set;
      const setter = {
        set cookie(value) {
          try {
            if (typeof value === "string") {
              const name = cookieNameBeingSet(value);
              if (name !== null) noteCookieName(name);
            }
          } catch { /* never disturb the page */ }
          apply(originalSet, this, [value]);
        },
      };
      const wrappedSet = disguise(getOwnDescriptor(setter, "cookie").set, originalSet);
      defineProperty(owner, "cookie", { ...desc, set: wrappedSet });
    }
  } catch { /* leave cookies alone */ }
})();
