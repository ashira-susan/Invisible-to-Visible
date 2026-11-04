# Third-party data and notices

This project bundles two data files inside the browser extension. Neither is our own work.

## Disconnect tracking-protection lists

- **Files used:** `services.json` and `entities.json` from <https://github.com/disconnectme/disconnect-tracking-protection>
- **Copyright:** 2010-2026 Disconnect, Inc.
- **Licence:** Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (<https://creativecommons.org/licenses/by-nc-sa/4.0/>)
- **What we changed:** `tools/build_extension_data.py` converts the two files into `extension/data/trackers.json`. It maps Disconnect's categories to ours, keeps one category per domain (the main purpose wins; membership of a fingerprinting list becomes a separate flag), replaces company names with the owning entity where `entities.json` has one, and drops entries that are not valid hostnames.
- **What this means for us:**
  - Attribution is required, which is what this file does.
  - The licence is **non-commercial**. Using the data in a commercial product would need a separate licence from Disconnect.
  - **ShareAlike:** `extension/data/trackers.json` is an adaptation, so it stays under the same licence if you share it. The project's own source code is a separate work.
- This is not legal advice. Ask your faculty guide if the project is assessed on licence compliance.

## Public Suffix List

- **File used:** `extension/data/public_suffix_list.dat`, copied unmodified.
- **Source:** <https://publicsuffix.org/list/>
- **Licence:** Mozilla Public License 2.0 (<https://mozilla.org/MPL/2.0/>), stated at the top of the file.
- **Purpose:** decides which part of a hostname is the "site", so `news.bbc.co.uk` and `bbc.co.uk` are first-party to each other while two different `.co.uk` sites are not.

## Refreshing the data

```
python tools/build_extension_data.py
```

downloads current versions of all three files and rewrites the two files under `extension/data/`. Run the extension tests afterwards (`cd extension && node --test`), then commit the result.
