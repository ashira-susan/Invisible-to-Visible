// Matches a hostname against the bundled tracker list (data/trackers.json).
// Entry format: "domain": [category, company, knownFingerprinter (0 or 1)]

export class TrackerList {
  constructor(data) {
    this.domains = data.domains;
  }

  /**
   * Returns { domain, category, company, knownFingerprinter } or null.
   * Tries the full hostname first, then each parent: ads.example.doubleclick.net,
   * example.doubleclick.net, doubleclick.net. The most specific entry wins.
   */
  classify(host) {
    const labels = host.split(".");
    for (let i = 0; i < labels.length - 1; i++) {
      const candidate = labels.slice(i).join(".");
      const entry = this.domains[candidate];
      if (entry) {
        return {
          domain: candidate,
          category: entry[0],
          company: entry[1] || null,
          knownFingerprinter: entry[2] === 1,
        };
      }
    }
    return null;
  }
}
