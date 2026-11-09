# Invisible to Visible (PriviLens)

**Status: M2c – In-Page Privacy Signal Collection completed, tested, merged into `main`, and tagged `v0.2-m2c`.**

Invisible to Visible (PriviLens) is a privacy-awareness project designed to make website visits and privacy-related activity more transparent through a browser extension, a local backend, and a dashboard.

The project aims to help users understand how websites interact with their browsers, including third-party tracking, cookie activity, referring sites, and selected browser API usage associated with fingerprinting.

## Current Implementation – M0 to M2c

The current implementation establishes a consent-based website monitoring and privacy signal collection flow.

- Chrome extension with explicit user consent and optional all-sites access.
- Captures website hostnames and HTTPS status.
- Sends summarized visit information to a FastAPI backend.
- Validates incoming data using a versioned data contract.
- Stores visit records in a local SQLite database.
- Detects third-party requests and classifies known trackers.
- Collects first-party, third-party, and tracker-associated cookie counts.
- Records the referring site's origin without storing the complete referrer URL.
- Observes selected in-page browser API calls associated with canvas, WebGL, audio, font measuring, and geolocation.
- Observes script-set cookies and uses one-way hashes for cookie identification.
- Displays recorded visits and available privacy signals in the dashboard.
- Supports pausing and resuming recording and deleting recorded data.
- Dynamically registers in-page scripts according to consent and permissions.

### Privacy by Design

The project follows a data-minimization and user-consent approach:

- Stores website hostnames rather than complete URLs.
- Does not collect URL paths, query parameters, page titles, or page content.
- Requires user consent before recording visits.
- Uses optional browser permissions for extended monitoring.
- Does not store cookie names or cookie values. Cookie names are hashed before being retained.
- Stores only the referring site's origin, not the complete referring page or search URL.
- Observes selected browser API calls without collecting actual geolocation coordinates.
- Keeps raw page-level activity inside the browser and sends summarized signals to the local backend.
- Supports pausing and withdrawing consent.

**Note:** In-page observations are best-effort measurements. They do not prove that fingerprinting or malicious activity has occurred. A zero count does not guarantee that a website is free from tracking.

## Built With

- **Python 3.14** – Backend development
- **FastAPI** – Backend API
- **SQLAlchemy** – Database interaction
- **SQLite** – Local data storage
- **Pydantic** – Data validation
- **JavaScript** – Browser extension and dashboard
- **HTML and CSS** – User interface
- **Chrome Extension APIs** – Browser integration
- **pytest** – Backend testing
- **Node.js Test Runner** – Extension testing

## Setup and Installation

### 1. Clone the Repository

```powershell
git clone https://github.com/ashira-susan/Invisible-to-Visible.git
cd Invisible-to-Visible
```

### 2. Set Up the Backend

Create a virtual environment from the project root:

```powershell
py -3.14 -m venv .venv
```

Activate it:

```powershell
.\.venv\Scripts\Activate.ps1
```

Move into the backend directory:

```powershell
cd backend
```

Install dependencies:

```powershell
python -m pip install -r requirements.txt
```

Start the FastAPI server:

```powershell
python -m uvicorn itv.main:app --reload
```

The backend runs at:

`http://127.0.0.1:8000`

API documentation:

`http://127.0.0.1:8000/docs`

Dashboard:

`http://127.0.0.1:8000/app/`

### 3. Load the Chrome Extension

1. Open `chrome://extensions/` in Google Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project's `extension` directory.
5. Pin the Invisible to Visible extension to the browser toolbar.
6. Open the extension and review the consent options.
7. Grant the optional permissions if you want extended privacy signal collection.

### Refresh Tracker Data

Run the following command from the project root to refresh the tracker data:

```powershell
python tools\build_extension_data.py
```

### 4. Run and Test the Application

1. Keep the FastAPI backend running.
2. Open the Invisible to Visible extension.
3. Review and grant recording consent.
4. Grant all-sites access if you want tracker and extended privacy signal monitoring.
5. Visit a website.
6. Open the dashboard through the extension.
7. Verify that the recorded website visit and available privacy signals appear in the dashboard.

You can also test pausing, resuming, withdrawing consent, cookie collection, and in-page signal observation using the supplied test pages.

## Testing

The M2c implementation includes:

- Backend API and data contract tests.
- Chrome extension unit and integration tests.
- In-page script and relay tests.
- Page-session and cookie handling tests.
- Browser-level testing in Google Chrome.
- Hostile-page testing for input validation, rate limiting, and count clamping.

Verified test results during M2c development:

- Backend: 58 tests passed.
- Extension: 121 tests passed.
- Total: 179 automated tests passed.

Real-Chrome testing was also performed for permission handling, script registration, consent changes, pause/resume behaviour, cookie handling, and hostile-page scenarios.

## Project Structure

```text
Invisible-to-Visible/
│
├── backend/
│   ├── itv/
│   ├── tests/
│   ├── tools/
│   ├── requirements.txt
│   └── requirements-dev.txt
│
├── dashboard/
│   ├── app.js
│   ├── index.html
│   └── styles.css
│
├── extension/
│   ├── consent/
│   ├── lib/
│   ├── inpage/
│   ├── popup/
│   ├── data/
│   ├── tests/
│   ├── background.js
│   ├── manifest.json
│   └── package.json
│
├── testpages/
│   ├── index.html
│   ├── hooks.html
│   ├── cookies.html
│   ├── frames.html
│   ├── hostile.html
│   ├── quiet.html
│   └── serve_cookies.py
│
├── tools/
│   └── build_extension_data.py
│
├── docs/
│   ├── data-contract.md
│   ├── THIRD_PARTY_NOTICES.md
│   ├── examples/
│   └── schemas/
│
└── legacy/
    ├── backend/
    ├── dashboard/
    └── extension/
```

The `legacy/` directory contains the archived earlier prototype. The active implementation is maintained in the main project directories.

## Roadmap

- [x] Clean project structure and repository history (M0)
- [x] Versioned data contract (M1)
- [x] FastAPI backend and scans API (M1)
- [x] Chrome extension consent flow (M1)
- [x] Hostname-based website visit capture (M1)
- [x] Dashboard visit history (M1)
- [x] Backend and extension tests (M1)
- [x] Third-party tracker detection (M2a)
- [x] Cookie counts and referrer-origin collection (M2b)
- [x] Canvas and WebGL API observation (M2c)
- [x] Audio and font-measuring API observation (M2c)
- [x] Geolocation API call observation (M2c)
- [x] Script-set cookie observation and hash-based deduplication (M2c)
- [x] Consent v4 and dynamic in-page script registration (M2c)
- [x] M2c merged into `main` and tagged `v0.2-m2c`
- [ ] Backend store improvements and data retention (M3)
- [ ] Develop and validate a transparent Privacy Score (M3)
- [ ] Improve unknown-versus-clean signal reporting (M3)
- [ ] Improve early-request attribution (M3)
- [ ] Develop dashboard visualizations and filtering (M4)
- [ ] Implement threat and trust analysis (M5)
- [ ] Develop intelligence and recommendation features (M6)
- [ ] Develop Data Ownership Mapping (M7)
- [ ] Strengthen security, performance, and documentation (M8)
- [ ] Complete evaluation and prepare the v1.0 release (M8)

## Why PriviLens Exists

Modern websites interact with users and collect information in ways that are not always immediately visible.

Invisible to Visible aims to make these activities easier to understand through a simple, transparent, and user-controlled interface.

The long-term goal is to develop a privacy-awareness and security intelligence platform that helps users better understand their digital exposure.

**The goal is to turn invisible digital activity into visible, understandable information.**

Feedback and suggestions are welcome!
