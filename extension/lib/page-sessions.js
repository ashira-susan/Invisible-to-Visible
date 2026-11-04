// Collects what one page does while it loads, on this device, then hands over a small
// summary. Raw request addresses are never kept: only a count of third-party requests
// and the names of known trackers. Nothing here talks to the network.

import { cleanHostname, siteFromUrl } from "./summary.js";
import { SETTLE_MS } from "./config.js";

export const MAX_TRACKERS = 200;
const MAX_COUNT = 100_000;
const PENDING_TTL_MS = 3_000;
const PENDING_MAX = 100;

export class PageSessions {
  /**
   * psl, trackers  lookups (PublicSuffixList, TrackerList)
   * store          { get(): Promise<object>, set(obj): Promise<void> }  survives service-worker restarts
   * onFinalize     async (page) => void   called once per finished page
   * now, schedule  injectable clock and timer for tests
   */
  constructor({ psl, trackers, store, onFinalize, settleMs = SETTLE_MS, now = () => Date.now(), schedule = setTimeout, cancel = clearTimeout }) {
    this.psl = psl;
    this.trackers = trackers;
    this.store = store;
    this.onFinalize = onFinalize;
    this.settleMs = settleMs;
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;

    this.pages = new Map(); // tabId -> page
    this.pending = new Map(); // tabId -> [{ host, t }]  requests seen just before the page started
    this.timers = new Map(); // tabId -> timer
    this.seq = 0;
    this.persistTimer = null;
  }

  async load() {
    const saved = (await this.store.get()) ?? {};
    for (const [tabId, page] of Object.entries(saved)) {
      this.pages.set(Number(tabId), page);
      this.seq = Math.max(this.seq, page.seq ?? 0);
      this.#arm(Number(tabId), page);
    }
  }

  /** A top-level page was committed in a tab. */
  async start(tabId, rawUrl) {
    // Requests seen a moment ago belong to the page that is starting now, not the old one.
    const early = this.pending.get(tabId) ?? [];
    this.pending.delete(tabId);

    await this.finalize(tabId); // leaving the previous page ends its visit

    const site = siteFromUrl(rawUrl);
    if (!site) return;

    const page = {
      seq: ++this.seq,
      host: site.domain,
      https: site.https,
      site: this.psl.registrableDomain(site.domain) ?? site.domain,
      startedAt: this.now(),
      thirdParty: 0,
      trackers: {}, // listed domain -> { category, company, fp }
    };
    this.pages.set(tabId, page);

    for (const r of early) {
      if (page.startedAt - r.t <= PENDING_TTL_MS) this.#record(page, r.host);
    }

    this.#arm(tabId, page);
    this.#persistSoon();
  }

  /** A sub-resource request (script, image, frame, ...) was made by a tab. */
  addRequest(tabId, rawUrl) {
    let host;
    try {
      const url = new URL(rawUrl);
      if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return;
      host = cleanHostname(url.hostname);
    } catch {
      return;
    }
    if (!host) return;

    const page = this.pages.get(tabId);
    if (page) {
      this.#record(page, host);
      this.#persistSoon();
      return;
    }

    const list = this.pending.get(tabId) ?? [];
    const t = this.now();
    const fresh = list.filter((r) => t - r.t <= PENDING_TTL_MS);
    fresh.push({ host, t });
    this.pending.set(tabId, fresh.slice(-PENDING_MAX));
  }

  /** The visit is over (settled, navigated away, or tab closed). Safe to call twice. */
  async finalize(tabId) {
    const page = this.pages.get(tabId);
    if (!page) return;

    this.pages.delete(tabId);
    const timer = this.timers.get(tabId);
    if (timer !== undefined) this.cancel(timer);
    this.timers.delete(tabId);

    await this.#persistNow();
    await this.onFinalize(page);
  }

  /** The tab was closed: finish its page and forget anything waiting for it. */
  async closeTab(tabId) {
    this.pending.delete(tabId);
    await this.finalize(tabId);
  }

  /** Writes the current state to the store now (tests, and before the worker stops). */
  async flush() {
    await this.#persistNow();
  }

  /** Finishes every page that has been open longer than the settle time. */
  async finalizeStale() {
    const t = this.now();
    for (const [tabId, page] of [...this.pages]) {
      if (t - page.startedAt >= this.settleMs) await this.finalize(tabId);
    }
  }

  /** The contract's `signals` object for a finished page. */
  static toSignals(page) {
    const trackers = Object.entries(page.trackers).map(([domain, t]) => {
      const entry = { domain, category: t.category };
      if (t.company) entry.company = t.company;
      if (t.fp) entry.known_fingerprinter = true;
      return entry;
    });
    return { trackers_checked: true, third_party_requests: Math.min(page.thirdParty, MAX_COUNT), trackers };
  }

  // ---- internals ----------------------------------------------------------

  #record(page, host) {
    const site = this.psl.registrableDomain(host) ?? host;
    if (site === page.site) return; // same site: first party

    if (page.thirdParty < MAX_COUNT) page.thirdParty += 1;

    const hit = this.trackers.classify(host);
    if (hit && !page.trackers[hit.domain] && Object.keys(page.trackers).length < MAX_TRACKERS) {
      page.trackers[hit.domain] = { category: hit.category, company: hit.company, fp: hit.knownFingerprinter };
    }
  }

  #arm(tabId, page) {
    const existing = this.timers.get(tabId);
    if (existing !== undefined) this.cancel(existing);
    const remaining = Math.max(0, this.settleMs - (this.now() - page.startedAt));
    const timer = this.schedule(() => {
      const current = this.pages.get(tabId);
      if (current && current.seq === page.seq) this.finalize(tabId);
    }, remaining);
    this.timers.set(tabId, timer);
  }

  #snapshot() {
    return Object.fromEntries(this.pages);
  }

  #persistSoon() {
    if (this.persistTimer !== null) return;
    this.persistTimer = this.schedule(() => {
      this.persistTimer = null;
      this.store.set(this.#snapshot());
    }, 500);
  }

  async #persistNow() {
    if (this.persistTimer !== null) {
      this.cancel(this.persistTimer);
      this.persistTimer = null;
    }
    await this.store.set(this.#snapshot());
  }
}
