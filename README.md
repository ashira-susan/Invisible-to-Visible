# Invisible to Visible (PriviLens)

**Status: M1 – Data Contract and First End-to-End Flow merged into `main`.**

Invisible to Visible (PriviLens) is a privacy-awareness project designed to make website visits and privacy-related activity more transparent through a browser extension and dashboard.

## Current Implementation – M1

The first implementation establishes a consent-based browser visit recording flow.

- Chrome extension with explicit user consent.
- Captures website hostnames when visiting websites.
- Sends visit information to a FastAPI backend.
- Validates incoming data using a versioned data contract.
- Stores visit records in a local SQLite database.
- Displays recorded visits in a day-grouped dashboard.
- Supports pausing and resuming recording, and deleting recorded data.

### Privacy by Design

M1 follows a hostname-only collection approach:

- Stores website hostnames rather than complete URLs.
- Does not collect URL paths, query parameters, page titles or page content.
- Requires user consent before recording visits.
- Does not collect cookies, browser fingerprints or tracking scripts in M1.

## Built With

- **Python** – Backend development
- **FastAPI** – Backend API
- **SQLite** – Local data storage
- **JavaScript** – Browser extension and dashboard
- **HTML and CSS** – User interface
- **Chrome Extension APIs** – Browser integration

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

### 3. Load the Chrome Extension

1. Open `chrome://extensions/` in Google Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project's `extension` directory.
5. Pin the PriviLens extension to the browser toolbar.

### Refresh Tracker Data

Run the following command from the project root to refresh the tracker data:

```powershell
python tools/build_extension_data.py
```

### 4. Run and Test the Application

1. Keep the FastAPI backend running.
2. Open the PriviLens extension.
3. Review and grant recording consent.
4. Visit a website.
5. Open the dashboard through the extension.
6. Verify that the recorded hostname appears in the visits list.

You can also test pausing, resuming and deleting recorded data.

## Testing

The M1 implementation includes:

- Backend API and data contract tests.
- Chrome extension tests.
- Browser-level end-to-end testing.

Verified test results during M1 development:

- Backend: 39 tests passed.
- Extension: 6 tests passed.

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
│   ├── popup/
│   ├── tests/
│   └── manifest.json
│
├── docs/
│   ├── data-contract.md
│   ├── examples/
│   └── schemas/
│
└── legacy/
    ├── backend/
    ├── dashboard/
    └── extension/
```

The `legacy/` directory contains the archived earlier prototype. The active M1 implementation is maintained in the main project directories.

## Roadmap

- [x] Clean project structure and repository history (M0)
- [x] Versioned data contract
- [x] FastAPI backend and scans API
- [x] Chrome extension consent flow
- [x] Hostname-only website visit capture
- [x] Dashboard visit history
- [x] Backend and extension tests
- [x] M1 implementation merged into `main`
- [ ] Expand privacy signal collection
- [ ] Detect third-party trackers and scripts
- [ ] Cookie and storage analysis
- [ ] Browser fingerprinting analysis
- [ ] Develop and validate privacy risk scoring
- [ ] Improve dashboard visualizations
- [ ] Strengthen error handling and performance
- [ ] Prepare for production deployment

## Why PriviLens Exists

Modern websites interact with users and collect information in ways that are not always immediately visible.

Invisible to Visible aims to make these activities easier to understand through a simple, transparent and user-controlled interface.

**The goal is to turn invisible digital activity into visible, understandable information.**

Feedback and suggestions are welcome!
