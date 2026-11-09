import test from "node:test";
import assert from "node:assert/strict";
import { syncHooks, desiredScripts, MAIN_ID, RELAY_ID } from "../lib/scripts.js";

/** A fake chrome.scripting that behaves like Chrome: ids are unique, unknown ids throw. */
function fakeScripting(initial = []) {
  const store = new Map(initial.map((s) => [s.id, structuredClone(s)]));
  const calls = [];
  return {
    store,
    calls,
    async getRegisteredContentScripts(filter) {
      calls.push(["get"]);
      return [...store.values()].filter((s) => !filter?.ids || filter.ids.includes(s.id)).map((s) => structuredClone(s));
    },
    async registerContentScripts(scripts) {
      calls.push(["register", scripts.map((s) => s.id)]);
      for (const s of scripts) {
        if (store.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
        store.set(s.id, structuredClone(s));
      }
    },
    async unregisterContentScripts(filter) {
      calls.push(["unregister", filter.ids]);
      for (const id of filter.ids) {
        if (!store.has(id)) throw new Error(`Nonexistent script ID '${id}'`);
        store.delete(id);
      }
    },
  };
}

test("the two scripts are described as the design says", () => {
  const [main, relay] = desiredScripts();
  assert.equal(main.id, MAIN_ID);
  assert.equal(main.world, "MAIN");
  assert.equal(relay.id, RELAY_ID);
  assert.equal(relay.world, "ISOLATED");
  for (const s of [main, relay]) {
    assert.equal(s.runAt, "document_start");
    assert.equal(s.allFrames, true);
    assert.equal(s.matchOriginAsFallback, true);
    assert.equal(s.persistAcrossSessions, true);
    assert.deepEqual(s.matches, ["http://*/*", "https://*/*"]);
    assert.deepEqual(s.excludeMatches, ["http://127.0.0.1:8000/*"]); // our own dashboard is never watched
  }
  assert.deepEqual(main.js, ["inpage/hooks-main.js"]);
  assert.deepEqual(relay.js, ["inpage/relay-isolated.js"]);
});

test("wanted: registers both scripts when none exist", async () => {
  const scripting = fakeScripting();
  const done = await syncHooks(scripting, true);
  assert.deepEqual(done.registered.sort(), [MAIN_ID, RELAY_ID].sort());
  assert.equal(scripting.store.size, 2);
});

test("wanted twice: the second call changes nothing (idempotent)", async () => {
  const scripting = fakeScripting();
  await syncHooks(scripting, true);
  scripting.calls.length = 0;
  const done = await syncHooks(scripting, true);
  assert.deepEqual(done.registered, []);
  assert.deepEqual(done.replaced, []);
  assert.deepEqual(done.unchanged.sort(), [MAIN_ID, RELAY_ID].sort());
  assert.deepEqual(scripting.calls, [["get"]]);
});

test("not wanted: removes what exists, and is quiet when nothing exists", async () => {
  const scripting = fakeScripting();
  await syncHooks(scripting, true);
  const done = await syncHooks(scripting, false);
  assert.deepEqual(done.unregistered.sort(), [MAIN_ID, RELAY_ID].sort());
  assert.equal(scripting.store.size, 0);

  scripting.calls.length = 0;
  const again = await syncHooks(scripting, false); // nothing to remove: must not throw
  assert.deepEqual(again.unregistered, []);
  assert.deepEqual(scripting.calls, [["get"]]);
});

test("repairs a missing script and replaces an outdated one", async () => {
  const scripting = fakeScripting();
  await syncHooks(scripting, true);
  scripting.store.delete(RELAY_ID); // lost
  scripting.store.get(MAIN_ID).matches = ["<all_urls>"]; // left over from an older version
  const done = await syncHooks(scripting, true);
  assert.deepEqual(done.registered, [RELAY_ID]);
  assert.deepEqual(done.replaced, [MAIN_ID]);
  assert.deepEqual(scripting.store.get(MAIN_ID).matches, ["http://*/*", "https://*/*"]);
});

test("scripts of other extensions features are left alone", async () => {
  const scripting = fakeScripting([{ id: "something-else", js: ["x.js"], matches: ["https://*/*"] }]);
  await syncHooks(scripting, true);
  await syncHooks(scripting, false);
  assert.ok(scripting.store.has("something-else"));
});
