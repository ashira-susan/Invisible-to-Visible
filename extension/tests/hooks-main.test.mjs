// Runs inpage/hooks-main.js inside a fake page (node:vm) to check what it counts and,
// just as important, that it never changes what the page sees.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const HOOKS = readFileSync(new URL("../inpage/hooks-main.js", import.meta.url), "utf8");

const FAKE_PAGE = `
globalThis.window = globalThis;
class CanvasRenderingContext2D {
  constructor(canvas) { this.canvas = canvas; this.font = "10px sans-serif"; }
  fillText() { return "fillText-result"; }
  strokeText() { return "strokeText-result"; }
  getImageData(...a) { return { tag: "image-data", a }; }
  measureText() { return { width: 7 }; }
}
class HTMLCanvasElement {
  getContext() { return (this._ctx ??= new CanvasRenderingContext2D(this)); }
  toDataURL(...a) { return "data:image/png;base64,AAAA" + a.length; }
  toBlob(cb) { return "blob-result"; }
}
class WebGLRenderingContext {
  getParameter(p) { return "value-" + p; }
  readPixels() { return "pixels"; }
}
class OfflineAudioContext { startRendering() { return "rendered"; } }
class AnalyserNode { constructor(context) { this.context = context; } getFloatFrequencyData() { return "freq"; } }
class Geolocation {
  getCurrentPosition() { return "current"; }
  watchPosition() { return 42; }
}
class FontFaceSet { check(font) { return true; } }
class Document {
  get cookie() { return "jar=" + __jar.length; }
  set cookie(value) { __jar.push(value); }
}
class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
for (const c of [CanvasRenderingContext2D, HTMLCanvasElement, WebGLRenderingContext, OfflineAudioContext, AnalyserNode, Geolocation, FontFaceSet, Document, CustomEvent]) {
  globalThis[c.name] = c;
}
globalThis.document = new Document();
document.fonts = new FontFaceSet();
globalThis.dispatchEvent = (event) => { if (__failDispatch) throw new Error("dispatch failed"); __events.push(event); return true; };
globalThis.addEventListener = (name, fn) => { __listeners[name] = fn; };
globalThis.setTimeout = (fn, ms) => { __timers.push({ fn, ms }); return __timers.length; };
globalThis.performance = { now: () => __clock.t };
`;

function makePage() {
  const host = { __jar: [], __events: [], __listeners: {}, __timers: [], __clock: { t: 0 }, __failDispatch: false };
  const context = vm.createContext(host);
  vm.runInContext(FAKE_PAGE, context);
  const before = {
    fillText: vm.runInContext("String(CanvasRenderingContext2D.prototype.fillText)", context),
    toDataURL: vm.runInContext("String(HTMLCanvasElement.prototype.toDataURL)", context),
    toString: vm.runInContext("String(Function.prototype.toString)", context),
    origFillTextRef: vm.runInContext("CanvasRenderingContext2D.prototype.fillText", context),
  };
  vm.runInContext(HOOKS, context);
  const run = (code) => vm.runInContext(code, context);
  const flush = () => { const t = host.__timers.splice(0); for (const { fn } of t) fn(); };
  const messages = () => host.__events.map((e) => JSON.parse(e.detail));
  /** Everything reported so far, added up. */
  const totals = () => {
    flush();
    const sum = { canvas: 0, webgl: 0, audio: 0, font: 0, geo: 0, cookies: [] };
    for (const m of messages()) {
      for (const k of ["canvas", "webgl", "audio", "font", "geo"]) sum[k] += m[k];
      sum.cookies.push(...m.cookies);
    }
    return sum;
  };
  return { host, context, run, flush, messages, totals, before };
}

test("canvas: only reading back a canvas that text was drawn on is counted", () => {
  const { run, totals } = makePage();
  run(`
    const c = new HTMLCanvasElement(); const ctx = c.getContext();
    ctx.fillText("hello", 1, 1);
    c.toDataURL(); ctx.getImageData(0, 0, 1, 1); c.toBlob(() => {});
    const plain = new HTMLCanvasElement(); plain.getContext();
    plain.toDataURL(); plain.getContext().getImageData(0, 0, 1, 1); plain.toBlob(() => {});
    const stroked = new HTMLCanvasElement(); stroked.getContext().strokeText("x", 0, 0); stroked.toDataURL();
  `);
  assert.equal(totals().canvas, 4); // 3 on the text canvas + 1 on the stroked one; none on the plain one
});

test("wrapped functions return exactly what the originals return, with the same arguments", () => {
  const { run } = makePage();
  assert.equal(run(`new HTMLCanvasElement().getContext().fillText("a", 1, 2)`), "fillText-result");
  assert.equal(run(`new HTMLCanvasElement().toDataURL("image/png", 0.5)`), "data:image/png;base64,AAAA2");
  assert.equal(run(`new WebGLRenderingContext().readPixels()`), "pixels");
  assert.equal(run(`new WebGLRenderingContext().getParameter(1234)`), "value-1234");
  assert.equal(run(`new Geolocation().watchPosition()`), 42);
  assert.equal(run(`new OfflineAudioContext().startRendering()`), "rendered");
  assert.deepEqual(JSON.parse(JSON.stringify(run(`new HTMLCanvasElement().getContext().getImageData(1, 2, 3, 4)`))), { tag: "image-data", a: [1, 2, 3, 4] });
});

test("an original that throws still throws the very same error", () => {
  const host = { __jar: [], __events: [], __listeners: {}, __timers: [], __clock: { t: 0 }, __failDispatch: false };
  const context = vm.createContext(host);
  vm.runInContext(FAKE_PAGE + `
    globalThis.__boom = new Error("original failed");
    Geolocation.prototype.getCurrentPosition = function getCurrentPosition() { throw __boom; };
  `, context);
  vm.runInContext(HOOKS, context);
  const outcome = vm.runInContext(`(() => { try { new Geolocation().getCurrentPosition(); } catch (e) { return e === __boom; } return "no throw"; })()`, context);
  assert.equal(outcome, true);
});

test("the wrappers look native: same name, length and toString as the originals", () => {
  const { run, before } = makePage();
  assert.equal(run(`String(CanvasRenderingContext2D.prototype.fillText)`), before.fillText);
  assert.equal(run(`String(HTMLCanvasElement.prototype.toDataURL)`), before.toDataURL);
  assert.equal(run(`String(Function.prototype.toString)`), before.toString);
  assert.equal(run(`CanvasRenderingContext2D.prototype.fillText.name`), "fillText");
  assert.equal(run(`HTMLCanvasElement.prototype.toBlob.name`), "toBlob");
  assert.equal(run(`HTMLCanvasElement.prototype.toBlob.length`), 1);
  assert.equal(run(`Function.prototype.toString.call(Function.prototype.toString)`), before.toString);
  assert.equal(run(`Object.getOwnPropertyDescriptor(Document.prototype, "cookie").set.name`), "set cookie");
  assert.equal(run(`typeof Object.getOwnPropertyDescriptor(Document.prototype, "cookie").get`), "function");
});

test("wrappers cannot be used with new, like native methods", () => {
  const { run } = makePage();
  assert.throws(() => run(`new HTMLCanvasElement.prototype.toDataURL()`), { name: "TypeError" });
});

test("WebGL: the unmasked vendor and renderer and pixel reads are counted; other queries are not", () => {
  const { run, totals } = makePage();
  run(`
    const gl = new WebGLRenderingContext();
    gl.getParameter(0x9245); gl.getParameter(0x9246); gl.getParameter(0x1F02); gl.getParameter(7938);
    gl.readPixels(0, 0, 1, 1);
  `);
  assert.equal(totals().webgl, 3);
});

test("audio: offline rendering counts; an ordinary analyser does not", () => {
  const { run, totals } = makePage();
  run(`
    const off = new OfflineAudioContext();
    off.startRendering();
    new AnalyserNode(off).getFloatFrequencyData();     // offline: counts
    new AnalyserNode({}).getFloatFrequencyData();      // a normal visualiser: does not
  `);
  assert.equal(totals().audio, 2);
});

test("location: both entry points are counted", () => {
  const { run, totals } = makePage();
  run(`const g = new Geolocation(); g.getCurrentPosition(); g.watchPosition(); g.watchPosition();`);
  assert.equal(totals().geo, 3);
});

test("fonts: a burst of 20 measureText calls with 10 or more fonts counts once", () => {
  const { run, totals } = makePage();
  run(`
    const ctx = new HTMLCanvasElement().getContext();
    for (let i = 0; i < 25; i++) { ctx.font = "12px F" + i; ctx.measureText("m"); }
  `);
  assert.equal(totals().font, 1);
});

test("fonts: many calls with few fonts, or too few calls, or a slow trickle do not count", () => {
  const few = makePage();
  few.run(`const ctx = new HTMLCanvasElement().getContext(); for (let i = 0; i < 100; i++) { ctx.font = "12px F" + (i % 3); ctx.measureText("m"); }`);
  assert.equal(few.totals().font, 0);

  const short = makePage();
  short.run(`const ctx = new HTMLCanvasElement().getContext(); for (let i = 0; i < 19; i++) { ctx.font = "12px F" + i; ctx.measureText("m"); }`);
  assert.equal(short.totals().font, 0);

  const slow = makePage();
  slow.run(`globalThis.__ctx = new HTMLCanvasElement().getContext();`);
  for (let i = 0; i < 60; i++) {
    slow.host.__clock.t += 150; // 150 ms apart: never 20 calls inside one second
    slow.run(`__ctx.font = "12px S${i}"; __ctx.measureText("m");`);
  }
  assert.equal(slow.totals().font, 0);
});

test("fonts: document.fonts.check follows the same burst rule", () => {
  const burst = makePage();
  burst.run(`for (let i = 0; i < 20; i++) document.fonts.check("12px C" + i);`);
  assert.equal(burst.totals().font, 1);

  const loader = makePage(); // a font loader checking one or two fonts is ordinary
  loader.run(`for (let i = 0; i < 50; i++) document.fonts.check("12px Roboto"); document.fonts.check("bold 12px Inter");`);
  assert.equal(loader.totals().font, 0);
});

test("fonts: a second burst counts again, but not twice for one burst", () => {
  const { run, host, totals } = makePage();
  run(`globalThis.__ctx = new HTMLCanvasElement().getContext();`);
  for (let round = 0; round < 2; round++) {
    run(`for (let i = 0; i < 20; i++) { __ctx.font = "12px R${"${round}"}_" + i; __ctx.measureText("m"); }`);
    host.__clock.t += 5_000;
  }
  assert.equal(totals().font, 2);
});

test("cookie writes: only the NAME is reported, never the value or attributes", () => {
  const { run, host, totals } = makePage();
  run(`document.cookie = "session_id=TOP_SECRET_VALUE; Path=/; Secure; SameSite=Lax";`);
  const sent = totals();
  assert.deepEqual(sent.cookies, ["session_id"]);
  const wire = host.__events.map((e) => e.detail).join("\n");
  assert.ok(!wire.includes("TOP_SECRET_VALUE"));
  assert.ok(!wire.includes("Secure"));
  assert.equal(host.__jar[0], "session_id=TOP_SECRET_VALUE; Path=/; Secure; SameSite=Lax"); // the real setter still got everything
});

test("cookie writes: repeats are reported once, deletions and nameless writes not at all", () => {
  const { run, totals } = makePage();
  run(`
    document.cookie = "a=1"; document.cookie = "a=2"; document.cookie = "a=3";
    document.cookie = "b=1; max-age=60";
    document.cookie = "gone=; max-age=0";
    document.cookie = "old=1; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    document.cookie = "nameless";
    document.cookie = "=novalue";
  `);
  assert.deepEqual(totals().cookies, ["a", "b"]);
});

test("cookie writes: the getter still works and non-string values are never converted by us", () => {
  const { run, host } = makePage();
  assert.equal(run(`document.cookie`), "jar=0");
  run(`document.cookie = "x=1"`);
  assert.equal(run(`document.cookie`), "jar=1");
  run(`globalThis.__calls = 0; document.cookie = { toString() { __calls++; return "y=1"; } };`);
  assert.equal(run(`__calls`), 0); // our code did not call toString on the page's object
  assert.equal(host.__jar.length, 2);
});

test("batching: nothing is sent until the timer fires, then one message with the right shape", () => {
  const { run, host, flush, messages } = makePage();
  run(`const g = new Geolocation(); g.getCurrentPosition(); document.cookie = "k=1";`);
  assert.equal(host.__events.length, 0);
  assert.equal(host.__timers.length, 1);
  flush();
  assert.equal(host.__events.length, 1);
  assert.equal(host.__events[0].type, "itv:inpage:v1");
  assert.equal(typeof host.__events[0].detail, "string");
  assert.deepEqual(messages()[0], { type: "itv-inpage", v: 1, canvas: 0, webgl: 0, audio: 0, font: 0, geo: 1, cookies: ["k"] });
  flush(); // nothing new: nothing sent
  assert.equal(host.__events.length, 1);
});

test("leaving the page sends what is waiting", () => {
  const { run, host, messages } = makePage();
  run(`new Geolocation().getCurrentPosition();`);
  host.__listeners.pagehide();
  assert.equal(messages().length, 1);
});

test("at most 25 new cookie names per message and 200 per page", () => {
  const { run, host, flush, messages } = makePage();
  run(`for (let i = 0; i < 300; i++) document.cookie = "c" + i + "=1";`);
  for (let i = 0; i < 20; i++) flush(); // keep flushing as the hooks reschedule themselves
  assert.ok(messages().every((m) => m.cookies.length <= 25));
  assert.equal(messages().flatMap((m) => m.cookies).length, 200);
  assert.ok(host.__events.length >= 8);
});

test("if reporting itself fails, the page's call still works and nothing is thrown", () => {
  const { run, host, flush } = makePage();
  host.__failDispatch = true;
  assert.equal(run(`new Geolocation().watchPosition()`), 42);
  assert.doesNotThrow(() => flush());
  assert.equal(run(`new HTMLCanvasElement().getContext().fillText("a", 0, 0)`), "fillText-result");
});

test("a page that replaces JSON, Set or setTimeout afterwards cannot break the hooks", () => {
  const { run, flush, totals } = makePage();
  run(`JSON.stringify = () => "broken"; globalThis.setTimeout = () => { throw new Error("no timers"); }; Set = function () { throw new Error("no sets"); };`);
  run(`new Geolocation().getCurrentPosition(); document.cookie = "after=1";`);
  const sent = totals();
  assert.equal(sent.geo, 1);
  assert.deepEqual(sent.cookies, ["after"]);
  assert.doesNotThrow(() => flush());
});

test("the hooks never touch what they do not watch", () => {
  const { run } = makePage();
  assert.equal(run(`typeof Object.getOwnPropertyDescriptor(Document.prototype, "cookie").enumerable`), "boolean");
  assert.equal(run(`Object.getOwnPropertyNames(globalThis).filter((n) => /itv/i.test(n)).length`), 0); // no globals left behind
});
