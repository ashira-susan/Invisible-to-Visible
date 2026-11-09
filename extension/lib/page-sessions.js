// Collects what one page does while it loads, on this device, then hands over a small
// summary. Raw request addresses are never kept: only a count of third-party requests
// and the names of known trackers. Nothing here talks to the network.

import { cleanHostname, siteFromUrl } from "./summary.js";
import { parseSetCookie, cookieKey } from "./cookies.js";
import { SETTLE_MS } from "./config.js";
import { sanitizeInpage } from "./inpage.js";

export const MAX_TRACKERS = 200;
const MAX_COUNT = 100_000;
const MAX_COOKIE_KEYS = 2_000;
const PENDING_TTL_MS = 3_000;
const PENDING_MAX = 100;
const REFERRER_TTL_MS = 30_000;

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
    // setTimeout and clearTimeout must be called as plain functions. Stored on this object
    // and called as this.schedule(...), Chrome refuses them ("Illegal invocation").
    this.schedule = (fn, ms) => schedule(fn, ms);
    this.cancel = (id) => cancel(id);

    this.pages = new Map(); // tabId -> page
    this.pending = new Map(); // tabId -> [item]  requests and cookies seen just before the page started
    this.referrers = new Map(); // tabId -> { origin, host, t }  from the page's own navigation request
    this.timers = new Map(); // tabId -> timer
    this.seq = 0;
    this.persistTimer = null;
  }

  async load() {
    const saved = (await this.store.get()) ?? {};
    for (const [tabId, page] of Object.entries(saved)) {
      page.cookies ??= { first: {}, third: {}, tracker: {} }; // pages saved by an older version
      page.referrer ??= null;
      page.fp ??= { canvas: 0, webgl: 0, audio: 0, font: 0 };
      page.geo ??= 0;
      this.pages.set(Number(tabId), page);
      this.seq = Math.max(this.seq, page.seq ?? 0);
      this.#arm(Number(tabId), page);
    }
  }

  /** A top-level page was committed in a tab. */
  async start(tabId, rawUrl) {
    // Leaving the previous page ends its visit. finalize() removes that page at once
    // (before its first await), so the tab has no "current page" from here on and
    // the new one can take over without waiting for the old summary to be sent. This
    // matters: sending can take a while, and the new page's first requests and
    // page-script reports arrive in that time. They must reach the new page.
    const finishing = this.finalize(tabId);

    // Read what was seen a moment ago only now, after the old page is gone.
    const early = this.pending.get(tabId) ?? [];
    this.pending.delete(tabId);
    const arrivedFrom = this.referrers.get(tabId);
    this.referrers.delete(tabId);

    const site = siteFromUrl(rawUrl);
    if (!site) {
      await finishing;
      return;
    }

    const page = {
      seq: ++this.seq,
      host: site.domain,
      https: site.https,
      site: this.psl.registrableDomain(site.domain) ?? site.domain,
      startedAt: this.now(),
      thirdParty: 0,
      trackers: {}, // listed domain -> { category, company, fp }
      cookies: { first: {}, third: {}, tracker: {} }, // hashed "host + cookie name" keys, nothing readable
      referrer: null, // origin only, e.g. https://www.google.com
      fp: { canvas: 0, webgl: 0, audio: 0, font: 0 }, // calls observed by the page-world hooks (best effort)
      geo: 0,
    };
    this.pages.set(tabId, page);

    for (const item of early) {
      if (page.startedAt - item.t > PENDING_TTL_MS) continue;
      if (item.kind === "cookies") this.#recordCookies(page, item.host, item.keys);
      else if (item.kind === "inpage") {
        // A late report from the page we just left: its top frame is another site.
        if (item.frameId === 0 && item.host !== null && item.host !== page.host) continue;
        this.#recordInpage(page, item);
      } else this.#record(page, item.host);
    }

    // Arriving from another site is worth knowing; arriving from the same site is not.
    if (arrivedFrom && page.startedAt - arrivedFrom.t <= REFERRER_TTL_MS) {
      const fromSite = this.psl.registrableDomain(arrivedFrom.host) ?? arrivedFrom.host;
      if (fromSite !== page.site) page.referrer = arrivedFrom.origin;
    }

    this.#arm(tabId, page);
    this.#persistSoon();
    await finishing; // callers still wait until the previous page has been handed over
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
    this.#hold(tabId, { kind: "request", host });
  }

  /**
   * A response set cookies. `setCookieHeaders` are the raw Set-Cookie values; they are
   * reduced to hashed keys immediately and the values are dropped.
   */
  addCookies(tabId, rawUrl, setCookieHeaders) {
    let host;
    try {
      const url = new URL(rawUrl);
      if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return;
      host = cleanHostname(url.hostname);
    } catch {
      return;
    }
    if (!host) return;

    const keys = [];
    for (const header of setCookieHeaders) {
      const cookie = parseSetCookie(header, this.now());
      if (cookie && !cookie.expired) keys.push(cookieKey(host, cookie.name));
    }
    if (keys.length === 0) return;

    const page = this.pages.get(tabId);
    if (page) {
      this.#recordCookies(page, host, keys);
      this.#persistSoon();
      return;
    }
    this.#hold(tabId, { kind: "cookies", host, keys });
  }

  /**
   * The page-world hooks reported something. EVERYTHING in `raw` came from the web page
   * and is untrusted: it is validated and clamped by sanitizeInpage(), and the message
   * has no say about which site it is from. `senderUrl` is sender.url, which Chrome
   * fills in; the host used for cookie hashing comes only from there.
   *
   * Cookie names are hashed right here, before anything is held or stored, so only
   * hashes ever sit in memory or in session storage.
   */
  addInpage(tabId, frameId, senderUrl, raw) {
    const clean = sanitizeInpage(raw);
    if (!clean) return;

    // The frame's host, or null for about:blank / srcdoc / anything else with no
    // trustworthy host. Without a host, its cookie names are dropped (counts still count).
    const site = siteFromUrl(typeof senderUrl === "string" ? senderUrl : "");
    const host = site ? site.domain : null;

    const page = this.pages.get(tabId);
    // A late message from the page we just left must not land on the new page.
    if (page && frameId === 0 && host !== null && host !== page.host) return;

    const keys = host ? clean.names.map((name) => cookieKey(host, name)) : [];
    const item = { kind: "inpage", frameId, host, keys, fp: clean.fingerprinting, geo: clean.geolocation };

    if (page) {
      this.#recordInpage(page, item);
      this.#persistSoon();
      return;
    }
    this.#hold(tabId, item);
  }

  /**
   * The page's own navigation request carried a Referer header. Only the origin is kept.
   * Called before the page starts, so it waits here for start() to pick it up.
   */
  setReferrer(tabId, rawReferer) {
    let origin;
    let host;
    try {
      const url = new URL(rawReferer);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      host = cleanHostname(url.hostname);
      if (!host) return;
      origin = `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`;
    } catch {
      return;
    }
    const existing = this.referrers.get(tabId);
    if (existing && this.now() - existing.t <= REFERRER_TTL_MS) return; // keep the first hop's referrer
    this.referrers.set(tabId, { origin, host, t: this.now() });
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
    this.referrers.delete(tabId);
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
    const cookies = page.cookies ?? { first: {}, third: {}, tracker: {} };
    const fp = page.fp ?? { canvas: 0, webgl: 0, audio: 0, font: 0 };
    return {
      trackers_checked: true,
      third_party_requests: Math.min(page.thirdParty, MAX_COUNT),
      trackers,
      cookies: {
        first_party: Object.keys(cookies.first).length,
        third_party: Object.keys(cookies.third).length,
        by_trackers: Object.keys(cookies.tracker).length,
      },
      fingerprinting: {
        canvas: Math.min(fp.canvas, MAX_COUNT),
        webgl: Math.min(fp.webgl, MAX_COUNT),
        audio: Math.min(fp.audio, MAX_COUNT),
        font: Math.min(fp.font, MAX_COUNT),
      },
      geolocation_calls: Math.min(page.geo ?? 0, MAX_COUNT),
    };
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

  #recordCookies(page, host, keys) {
    const site = this.psl.registrableDomain(host) ?? host;
    const firstParty = site === page.site;
    const bucket = firstParty ? page.cookies.first : page.cookies.third;
    const isTracker = !firstParty && this.trackers.classify(host) !== null;
    for (const key of keys) {
      if (Object.keys(bucket).length < MAX_COOKIE_KEYS) bucket[key] = 1;
      if (isTracker && Object.keys(page.cookies.tracker).length < MAX_COOKIE_KEYS) page.cookies.tracker[key] = 1;
    }
  }

  #recordInpage(page, item) {
    for (const name of ["canvas", "webgl", "audio", "font"]) {
      page.fp[name] = Math.min(page.fp[name] + item.fp[name], MAX_COUNT);
    }
    page.geo = Math.min(page.geo + item.geo, MAX_COUNT);
    // Script-set cookies go into the same hashed buckets as header cookies, so a cookie
    // seen both ways (same host, same name) is counted once.
    if (item.host && item.keys.length > 0) this.#recordCookies(page, item.host, item.keys);
  }

  #hold(tabId, item) {
    const t = this.now();
    const fresh = (this.pending.get(tabId) ?? []).filter((r) => t - r.t <= PENDING_TTL_MS);
    fresh.push({ ...item, t });
    this.pending.set(tabId, fresh.slice(-PENDING_MAX));
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
