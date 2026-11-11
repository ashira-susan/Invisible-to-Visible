// Runs inpage/relay-isolated.js in a fake extension world. Everything the page sends it
// is untrusted, so most of these tests are about what it refuses and how little it forwards.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const RELAY = readFileSync(new URL("../inpage/relay-isolated.js", import.meta.url), "utf8");
const EVENT = "itv:inpage:v1";

function makeRelay({ sendBehaviour = "ok", topFrame = false } = {}) {
  const host = { __sent: [], __listeners: {}, __timers: [], __cleared: [] };
  host.chrome = {
    runtime: {
      sendMessage: (message) => {
        if (sendBehaviour === "throw") throw new Error("Extension context invalidated.");
        host.__sent.push(JSON.parse(JSON.stringify(message)));
        return sendBehaviour === "reject" ? Promise.reject(new Error("no worker")) : Promise.resolve();
      },
    },
  };
  const context = vm.createContext(host);
  vm.runInContext(`
    globalThis.window = globalThis;
    ${topFrame === "throws"
      ? 'Object.defineProperty(globalThis, "top", { get() { throw new Error("blocked a frame with origin"); } });'
      : topFrame ? "globalThis.top = globalThis;" : "globalThis.top = {};"}
    globalThis.addEventListener = (name, fn) => { (__listeners[name] ??= []).push(fn); };
    globalThis.setTimeout = (fn, ms) => { __timers.push({ fn, ms }); return __timers.length; };
    globalThis.clearTimeout = (id) => { __cleared.push(id); if (__timers[id - 1]) __timers[id - 1].dead = true; };
  `, context);
  vm.runInContext(RELAY, context);

  const fire = (detail) => { for (const fn of host.__listeners[EVENT] ?? []) fn({ detail }); };
  const fireObj = (obj) => fire(JSON.stringify(obj));
  const tick = () => {
    const due = host.__timers.splice(0).filter((t) => !t.dead);
    for (const { fn } of due) fn();
  };
  return { host, fire, fireObj, tick };
}

const ok = (extra = {}) => ({ type: "itv-inpage", v: 1, ...extra });

test("a valid event is forwarded once, on the next tick, in the fixed shape", () => {
  const { host, fireObj, tick } = makeRelay();
  fireObj(ok({ canvas: 2, geo: 1, cookies: ["a", "b"] }));
  assert.equal(host.__sent.length, 0);
  tick();
  assert.deepEqual(host.__sent, [{ type: "itv-inpage", v: 1, canvas: 2, webgl: 0, audio: 0, font: 0, geo: 1, cookies: ["a", "b"] }]);
});

test("many events in one tick become one message", () => {
  const { host, fireObj, tick } = makeRelay();
  for (let i = 0; i < 500; i++) fireObj(ok({ canvas: 1, webgl: 1 }));
  assert.equal(host.__timers.length, 1); // one timer, not 500
  tick();
  assert.equal(host.__sent.length, 1);
  assert.equal(host.__sent[0].canvas, 500);
});

test("numbers are clamped: a flood of huge values is at most 1000 per tick", () => {
  const { host, fireObj, tick } = makeRelay();
  for (let i = 0; i < 100; i++) fireObj(ok({ canvas: 1e12, webgl: Number.MAX_SAFE_INTEGER, audio: -4, font: 2.5, geo: "9" }));
  tick();
  assert.deepEqual(
    { c: host.__sent[0].canvas, w: host.__sent[0].webgl, a: host.__sent[0].audio, f: host.__sent[0].font, g: host.__sent[0].geo },
    { c: 1000, w: 1000, a: 0, f: 0, g: 0 },
  );
});

test("things that are not our event are ignored", () => {
  const { host, fire, fireObj, tick } = makeRelay();
  fire("not json");
  fire(undefined);
  fire(42);
  fire(null);
  fire("x".repeat(9_000));                       // too long
  fire(JSON.stringify([1, 2, 3]));
  fire(JSON.stringify("string"));
  fireObj({ type: "other", v: 1, canvas: 5 });
  fireObj({ type: "itv-inpage", v: 2, canvas: 5 });
  fireObj({ type: "itv-inpage", canvas: 5 });
  assert.equal(host.__timers.length, 0);
  tick();
  assert.equal(host.__sent.length, 0);
});

test("an event that reports nothing sends nothing", () => {
  const { host, fireObj, tick } = makeRelay();
  fireObj(ok({ canvas: 0, cookies: [] }));
  tick();
  assert.equal(host.__sent.length, 0);
});

test("a made-up host, url or any extra field is never forwarded", () => {
  const { host, fireObj, tick } = makeRelay();
  fireObj(ok({ canvas: 1, host: "evil.example", url: "https://evil.example/", domain: "ads.test", cookies: ["a"] }));
  tick();
  assert.ok(!JSON.stringify(host.__sent).includes("evil"));
  assert.deepEqual(Object.keys(host.__sent[0]).sort(), ["audio", "canvas", "cookies", "font", "geo", "type", "v", "webgl"]);
});

test("cookie names: bad ones are dropped, 25 per message, 200 per frame in total", () => {
  const { host, fireObj, tick } = makeRelay();
  fireObj(ok({ cookies: ["ok", "", "a\u0000b", "nl\n", "x".repeat(129), 5, null, {}, "fine"] }));
  tick();
  assert.deepEqual(host.__sent[0].cookies, ["ok", "fine"]);

  const flood = makeRelay();
  for (let i = 0; i < 2_000; i++) flood.fireObj(ok({ cookies: Array.from({ length: 500 }, (_, k) => `n${i}_${k}`) }));
  for (let t = 0; t < 40; t++) flood.tick();
  assert.ok(flood.host.__sent.every((m) => m.cookies.length <= 25));
  assert.equal(flood.host.__sent.flatMap((m) => m.cookies).length, 200);
});

test("leaving the page sends what is waiting straight away and cancels the timer", () => {
  const { host, fireObj, tick } = makeRelay();
  fireObj(ok({ canvas: 3 }));
  host.__listeners.pagehide[0]();
  assert.equal(host.__sent.length, 1);
  assert.equal(host.__cleared.length, 1);
  tick(); // the cancelled timer must not send a duplicate
  assert.equal(host.__sent.length, 1);
});

test("a missing worker or an invalidated extension never throws into the page", async () => {
  for (const sendBehaviour of ["reject", "throw"]) {
    const { host, fireObj, tick } = makeRelay({ sendBehaviour });
    fireObj(ok({ canvas: 1 }));
    assert.doesNotThrow(() => tick());
    await new Promise((resolve) => setImmediate(resolve)); // let a rejected promise settle: it must be handled
    assert.ok(host.__sent.length <= 1);
  }
});

// ---- the heartbeat: "the page scripts ran in this top frame" ----

test("the top frame sends one heartbeat at once and another when the page has loaded", () => {
  const { host } = makeRelay({ topFrame: true });
  assert.deepEqual(host.__sent, [{ type: "itv-inpage", v: 1, hb: 1 }]);
  host.__listeners.load[0]();
  assert.deepEqual(host.__sent, [{ type: "itv-inpage", v: 1, hb: 1 }, { type: "itv-inpage", v: 1, hb: 1 }]);
});

test("a sub-frame sends no heartbeat", () => {
  const { host } = makeRelay({ topFrame: false });
  host.__listeners.load?.forEach((fn) => fn());
  assert.equal(host.__sent.length, 0);
});

test("a frame whose top cannot be compared is treated as a sub-frame", () => {
  const { host } = makeRelay({ topFrame: "throws" });
  host.__listeners.load?.forEach((fn) => fn());
  assert.equal(host.__sent.length, 0);
});

test("a heartbeat that cannot be delivered is ignored, never thrown", () => {
  for (const sendBehaviour of ["throw", "reject"]) {
    const { host } = makeRelay({ topFrame: true, sendBehaviour });
    assert.doesNotThrow(() => host.__listeners.load[0]());
  }
});

test("a web page cannot make the relay send a heartbeat by itself", () => {
  const { host, fireObj, tick } = makeRelay({ topFrame: false });
  fireObj(ok({ hb: 1 }));
  fireObj({ type: "itv-inpage", v: 1, hb: 1, canvas: 0 });
  tick();
  assert.equal(host.__sent.length, 0);
});
