// Collects what one page does while it loads, on this device, then hands over a small
// summary. Raw request addresses are never kept: only a count of third-party requests
// and the names of known trackers. Nothing here talks to the network.

import { cleanHostname, siteFromUrl } from "./summary.js";
import { parseSetCookie, cookieKey } from "./cookies.js";
import { SETTLE_MS } from "./config.js";
import { sanitizeInpage, isHeartbeat } from "./inpage.js";

export const MAX_TRACKERS = 200;
const MAX_COUNT = 100_000;
const MAX_COOKIE_KEYS = 2_000;
const PENDING_TTL_MS = 3_000;
const PENDING_MAX = 100;
const NAV_TTL_MS = 30_000; // how long a navigation may stay "in progress" before it is forgotten

// A short one-way fingerprint of a page address with its #fragment removed. It is used
// only to check "is the page that just committed the one this navigation was heading
// to?" so the address itself is never kept, not even in memory.
function urlKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return cookieKey("navigation", url.href);
  } catch {
    return null;
  }
}

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
    // A tab's "navigation in progress", from its first top-level request until the page
    // commits. Events are only held for a page that has not started yet while one is in
    // progress; with none, they are dropped (a late beacon from the page we left must never
    // be given to the next page). Kept in memory only: after a worker restart mid-navigation
    // the events are simply missed, which can only undercount.
    this.navs = new Map(); // tabId -> { requestId, key, referrer, t }
    this.pending = new Map(); // tabId -> [item]  events held during the navigation in progress
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
      page.documentId ??= null;
      page.inpage ??= false; // saved by an older version: unknown, so "not checked"
      this.pages.set(Number(tabId), page);
      this.seq = Math.max(this.seq, page.seq ?? 0);
      this.#arm(Number(tabId), page);
    }
  }

  /**
   * A top-level page was committed in a tab. `documentId` is Chrome's id for the committed
   * document (webNavigation.onCommitted); held events are only given to the new page when
   * Chrome says they came from that very document (see #belongsTo).
   */
  async start(tabId, rawUrl, documentId = null) {
    // Leaving the previous page ends its visit. finalize() removes that page at once
    // (before its first await), so the tab has no "current page" from here on and
    // the new one can take over without waiting for the old summary to be sent. This
    // matters: sending can take a while, and the new page's first requests and
    // page-script reports arrive in that time. They must reach the new page.
    const finishing = this.finalize(tabId);

    // Read what was held during this navigation only now, after the old page is gone.
    const nav = this.#navigating(tabId);
    const early = this.pending.get(tabId) ?? [];
    this.pending.delete(tabId);
    this.navs.delete(tabId);
    // The navigation's own events (its response cookies, its Referer) belong to this page
    // only if the page that committed is the page the navigation was heading to.
    const sameNavigation = nav !== null && nav.key !== null && nav.key === urlKey(rawUrl);

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
      documentId: typeof documentId === "string" && documentId !== "" ? documentId : null, // Chrome's id for this document
      inpage: false, // true once the page scripts reported (heartbeat) from this document's top frame
    };
    this.pages.set(tabId, page);

    for (const item of early) {
      if (!this.#belongsTo(item, { sameNavigation, documentId: page.documentId })) continue;
      if (item.kind === "cookies") this.#recordCookies(page, item.host, item.keys);
      else if (item.kind === "inpage") {
        // A late report from the page we just left: its top frame is another site.
        if (item.frameId === 0 && item.host !== null && item.host !== page.host) continue;
        this.#recordInpage(page, item);
      } else this.#record(page, item.host);
    }

    // Arriving from another site is worth knowing; arriving from the same site is not.
    if (sameNavigation && nav.referrer) {
      const fromSite = this.psl.registrableDomain(nav.referrer.host) ?? nav.referrer.host;
      if (fromSite !== page.site) page.referrer = nav.referrer.origin;
    }

    this.#arm(tabId, page);
    this.#persistSoon();
    await finishing; // callers still wait until the previous page has been handed over
  }

  /**
   * A top-level navigation request was made in a tab (webRequest, type main_frame).
   * Redirect hops of one navigation share Chrome's requestId; a different requestId is a
   * new navigation, and whatever was held for the old one is dropped with it.
   */
  noteMainRequest(tabId, requestId, rawUrl) {
    const key = urlKey(rawUrl);
    if (key === null || typeof requestId !== "string" || requestId === "") return;
    const nav = this.navs.get(tabId);
    if (nav && nav.requestId === requestId && this.now() - nav.t <= NAV_TTL_MS) {
      nav.key = key; // a redirect hop: the final hop's address is the one that commits
      return;
    }
    this.pending.delete(tabId);
    this.navs.set(tabId, { requestId, key, referrer: null, t: this.now() });
  }

  /**
   * A sub-resource request (script, image, frame, ...) was made by a tab.
   * `meta` = { documentId, parentDocumentId, documentLifecycle, frameId } as Chrome
   * reports them for the request.
   */
  addRequest(tabId, rawUrl, meta = {}) {
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
      if (this.#fromAnotherDocument(page, meta)) return;
      this.#record(page, host);
      this.#persistSoon();
      return;
    }
    this.#holdForDocument(tabId, { kind: "request", host }, meta);
  }

  /**
   * A response set cookies. `setCookieHeaders` are the raw Set-Cookie values; they are
   * reduced to hashed keys immediately and the values are dropped.
   * `meta` = { mainFrame, requestId, documentId, frameId } as Chrome reports them.
   */
  addCookies(tabId, rawUrl, setCookieHeaders, meta = {}) {
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

    // A top-level response is part of a navigation, never of the page still on screen while
    // the new one loads. It is held for the navigation it belongs to (same requestId) and
    // dropped when that cannot be established.
    if (meta.mainFrame === true) {
      const nav = this.#navigating(tabId);
      if (!nav || typeof meta.requestId !== "string" || nav.requestId !== meta.requestId) return;
      this.#hold(tabId, { kind: "cookies", host, keys, owner: "navigation" });
      return;
    }

    const page = this.pages.get(tabId);
    if (page) {
      if (this.#fromAnotherDocument(page, meta)) return;
      this.#recordCookies(page, host, keys);
      this.#persistSoon();
      return;
    }
    this.#holdForDocument(tabId, { kind: "cookies", host, keys }, meta);
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
  addInpage(tabId, frameId, senderUrl, raw, documentId = null) {
    const clean = sanitizeInpage(raw);
    const heartbeat = isHeartbeat(raw) && frameId === 0; // "the page scripts ran here": top frame only
    if (!clean && !heartbeat) return;

    // The frame's host, or null for about:blank / srcdoc / anything else with no
    // trustworthy host. Without a host, its cookie names are dropped (counts still count).
    const site = siteFromUrl(typeof senderUrl === "string" ? senderUrl : "");
    const host = site ? site.domain : null;

    const page = this.pages.get(tabId);
    // A late message from the page we just left must not land on the new page.
    if (page && frameId === 0 && host !== null && host !== page.host) return;

    const keys = host && clean ? clean.names.map((name) => cookieKey(host, name)) : [];
    const fp = clean ? clean.fingerprinting : { canvas: 0, webgl: 0, audio: 0, font: 0 };
    const item = { kind: "inpage", frameId, host, keys, fp, geo: clean ? clean.geolocation : 0, hb: heartbeat };

    if (page) {
      // The heartbeat is believed only when it comes from this very document: a late one
      // from the page we left (even on the same site) must not make this page look checked.
      item.hb = heartbeat && documentId !== null && documentId === page.documentId;
      this.#recordInpage(page, item);
      this.#persistSoon();
      return;
    }
    this.#holdForDocument(tabId, item, { documentId, frameId });
  }

  /**
   * The page's own navigation request carried a Referer header. Only the origin is kept.
   * Called before the page starts, so it waits (with the navigation) for start() to pick
   * it up. `requestId` must be the navigation's own request.
   */
  setReferrer(tabId, rawReferer, requestId = null) {
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
    const nav = this.#navigating(tabId);
    if (!nav || typeof requestId !== "string" || nav.requestId !== requestId) return; // not this navigation's request
    if (nav.referrer) return; // keep the first hop's referrer
    nav.referrer = { origin, host };
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
    this.navs.delete(tabId);
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
      inpage_checked: page.inpage === true, // false = the page scripts never reported: zeros mean "not checked"
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
    if (item.hb) page.inpage = true;
    for (const name of ["canvas", "webgl", "audio", "font"]) {
      page.fp[name] = Math.min(page.fp[name] + item.fp[name], MAX_COUNT);
    }
    page.geo = Math.min(page.geo + item.geo, MAX_COUNT);
    // Script-set cookies go into the same hashed buckets as header cookies, so a cookie
    // seen both ways (same host, same name) is counted once.
    if (item.host && item.keys.length > 0) this.#recordCookies(page, item.host, item.keys);
  }

  /**
   * Is this request or response from a document that is not the page on screen?
   * Chrome keeps pages you have left in its back/forward cache, and their frozen frames
   * can still send requests right after the next page commits (seen in Chrome: ~30
   * requests from the previous page's ad frames, marked documentLifecycle "cached"). Two
   * things identify them, and anything else is given the benefit of the doubt:
   *  - a lifecycle other than "active" (cached, pending deletion, prerender);
   *  - a top-level document (no parent) whose id is not the committed page's id. Chrome's
   *    ids were checked in Chrome: a top-frame request carries the id onCommitted gave.
   * Sub-frames whose parent is deeper than one level cannot be tied to a page this way.
   */
  #fromAnotherDocument(page, meta) {
    if (typeof meta.documentLifecycle === "string" && meta.documentLifecycle !== "active") return true;
    const own = typeof meta.documentId === "string" && meta.documentId !== "";
    const hasParent = typeof meta.parentDocumentId === "string" && meta.parentDocumentId !== "";
    return page.documentId !== null && page.documentId !== undefined && own && !hasParent && meta.documentId !== page.documentId;
  }

  /** The tab's navigation in progress, or null (also forgets one that has gone stale). */
  #navigating(tabId) {
    const nav = this.navs.get(tabId);
    if (!nav) return null;
    if (this.now() - nav.t > NAV_TTL_MS) {
      this.navs.delete(tabId);
      this.pending.delete(tabId);
      return null;
    }
    return nav;
  }

  /**
   * Holds an event that came from a document (not from the navigation request itself) for a
   * page that has not started yet, together with the document Chrome says made it. With no
   * navigation in progress there is nothing it could belong to, so it is dropped.
   */
  #holdForDocument(tabId, item, meta) {
    if (!this.#navigating(tabId)) return;
    this.#hold(tabId, {
      ...item,
      owner: "document",
      docId: typeof meta.documentId === "string" && meta.documentId !== "" ? meta.documentId : null,
      frameId: Number.isInteger(meta.frameId) ? meta.frameId : null,
    });
  }

  /**
   * May a held event be given to the page that just committed? Only when its attribution is
   * certain; anything ambiguous is dropped (an undercount, never a misattribution).
   *  - the navigation's own events (response cookies, Referer): only if the committed page
   *    is the page that navigation was heading to;
   *  - events from a document: only from the top frame, and only if Chrome's documentId for
   *    the event is the committed document's. Sub-frame events cannot be tied to the new
   *    page this way and are dropped.
   */
  #belongsTo(item, { sameNavigation, documentId }) {
    if (item.owner === "navigation") return sameNavigation;
    if (this.now() - item.t > PENDING_TTL_MS) return false;
    return documentId !== null && item.docId === documentId && item.frameId === 0;
  }

  #hold(tabId, item) {
    const t = this.now();
    const fresh = (this.pending.get(tabId) ?? []).filter((r) => r.owner === "navigation" || t - r.t <= PENDING_TTL_MS);
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
