// Registers (or removes) the two page scripts. They run in every page you visit, so
// they exist only while recording is on, tracker detection is allowed and Chrome's
// all-sites access is granted. Calling this is always safe: it only changes what
// differs from what is wanted, so it can run on every start and every settings change.

import { API_BASE } from "./config.js";

export const MAIN_ID = "itv-hooks-main";
export const RELAY_ID = "itv-hooks-relay";

const COMMON = {
  matches: ["http://*/*", "https://*/*"],
  excludeMatches: [`${new URL(API_BASE).origin}/*`], // never watch our own dashboard
  allFrames: true,
  matchOriginAsFallback: true, // also cover about:blank and srcdoc frames (Chrome 119+)
  runAt: "document_start",
  persistAcrossSessions: true,
};

/** The scripts that should exist while hooks are wanted. */
export function desiredScripts() {
  return [
    { ...COMMON, id: MAIN_ID, js: ["inpage/hooks-main.js"], world: "MAIN" },
    { ...COMMON, id: RELAY_ID, js: ["inpage/relay-isolated.js"], world: "ISOLATED" },
  ];
}

function sameScript(wanted, existing) {
  return Object.keys(wanted).every((key) => JSON.stringify(wanted[key]) === JSON.stringify(existing[key]));
}

/**
 * Makes the registered scripts match `wanted` (true = registered, false = none).
 * `scripting` is chrome.scripting (or a fake in tests).
 * Returns what it did, for logging and tests.
 */
export async function syncHooks(scripting, wanted) {
  const ids = [MAIN_ID, RELAY_ID];
  const existing = await scripting.getRegisteredContentScripts({ ids });
  const byId = new Map(existing.map((script) => [script.id, script]));
  const done = { registered: [], replaced: [], unregistered: [], unchanged: [] };

  if (!wanted) {
    const present = ids.filter((id) => byId.has(id));
    if (present.length > 0) await scripting.unregisterContentScripts({ ids: present });
    done.unregistered = present;
    return done;
  }

  for (const script of desiredScripts()) {
    const current = byId.get(script.id);
    if (!current) {
      await scripting.registerContentScripts([script]);
      done.registered.push(script.id);
    } else if (!sameScript(script, current)) {
      await scripting.unregisterContentScripts({ ids: [script.id] });
      await scripting.registerContentScripts([script]);
      done.replaced.push(script.id);
    } else {
      done.unchanged.push(script.id);
    }
  }
  return done;
}
