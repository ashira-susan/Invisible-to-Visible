**Invisible to Visible 🕵️‍♂️**

**🚧 Status: In Progress** — actively being built and improved.

A privacy-monitoring tool that detects web tracking, data collection, and fingerprinting attempts in real time — and scores how trustworthy a site is.

---

**🚀 What it does**
Detects hidden tracking scripts, cookies, and fingerprinting techniques on websites
Calculates a real-time **Trust Score** based on privacy risk
Makes invisible data-collection activity visible to the user
Available both as a **web application** and a **browser extension**

---

**🛠️ Built With**
**Python** — backend logic / analysis
**HTML, CSS, JavaScript** — frontend and browser extension

---

**⚙️ Setup & Installation**

Follow the steps below to set up and run PriviLens locally.

**1. Clone the Repository**

```powershell
git clone https://github.com/ashira-susan/Invisible-to-Visible.git
cd Invisible-to-Visible
```

### Backend Setup

From the project root, create a Python virtual environment:

```powershell
py -3.14 -m venv .venv
```

Activate it in PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Install the dependencies:

```powershell
python -m pip install -r .\backend\requirements.txt
```

Start the backend from the `backend` directory:

```powershell
cd backend
python -m uvicorn app:app --reload
```

The backend will be available at `http://127.0.0.1:8000`, and the API documentation at `http://127.0.0.1:8000/docs`.

If PowerShell blocks virtual-environment activation, use the environment's Python executable directly instead:

```powershell
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
```

Then start the server from the `backend` directory with:

```powershell
..\.venv\Scripts\python.exe -m uvicorn app:app --reload
```

The backend will be available at: ``` http://127.0.0.1:8000 ```

**3. Load the Browser Extension**

PriviLens uses a browser extension to capture privacy-related signals from websites.

**For Google Chrome:**

Open chrome://extensions/
Enable Developer mode
Click Load unpacked
Select the project's extension directory
Pin the PriviLens extension to the browser toolbar

**For Microsoft Edge:**

Open edge://extensions/
Enable Developer mode
Click Load unpacked
Select the project's extension directory

**4. Run the Application**

Ensure that the FastAPI backend is running before testing the extension. Open a website in Chrome or Edge and click the PriviLens extension. The extension analyzes privacy-related signals such as:

Cookies and storage usage
Third-party scripts and trackers
Browser fingerprinting indicators
HTTPS security
Network and website activity

The collected signals are sent to the backend for analysis and used to generate the website's Digital Trust Score.

**5. Verify the Setup**

If the setup is successful:

✅ The FastAPI backend runs on 127.0.0.1:8000
✅ The PriviLens extension appears in the browser
✅ Website privacy signals are detected
✅ Signals are processed by the backend
✅ A privacy/trust analysis is displayed in the extension

**Note:** Keep the backend server running while testing the browser extension.

---

## 📸 Preview

> 🚧 **Prototype / Work in Progress**

PriviLens is currently under active development. The current prototype demonstrates real-time website privacy signal detection and analysis, including cookies, storage usage, scripts, trackers, browser fingerprinting indicators, and HTTPS status.

### Current Prototype

* 🖥️ PriviLens browser extension popup
  <img width="1917" height="1023" alt="image" src="https://github.com/user-attachments/assets/3dd9b49e-f020-4375-91b5-3e892641caa1" />
* 🔍 Website privacy signal detection
  <img width="617" height="492" alt="image" src="https://github.com/user-attachments/assets/21d0edb2-1363-4b37-bbae-7e811b982f2a" />
* ⚙️ Backend analysis response
  <img width="1301" height="985" alt="image" src="https://github.com/user-attachments/assets/b3e9c1e8-cf98-4b7b-bad8-9653a06021e3" />


> **Note:** The screenshots represent the current development prototype. The user interface, detection capabilities, and Trust Score logic are continuously being improved.

---

**📌 Why I Built This**

Built to raise awareness of how much tracking happens invisibly while browsing, and to give users a simple, visual way to see and understand it.
Modern websites collect and process a significant amount of information in the background, often without users clearly understanding what is happening.

**PriviLens** – Invisible to Visible was built to make these invisible privacy activities more transparent. The project aims to help users understand what websites can observe, what privacy signals are being generated, and how these signals contribute to an overall Trust Score through a simple and visual interface.

The goal is to turn complex privacy information into insights that are easier for everyday users to understand.

🔮 Roadmap / What's Left

PriviLens is currently a working prototype and is under active development.

Browser extension prototype ✅

Website privacy signal collection✅

Cookie and storage analysis✅

Script and tracker detection✅

Browser fingerprinting signal collection✅

HTTPS/security signal detection✅

FastAPI backend integration✅

Initial Trust Score implementation✅

Refine and validate Trust Score calculation✅

Expand tracker and third-party domain detection❌

Improve frontend dashboard and visualizations❌

Strengthen real-time communication between extension and backend❌

Add more comprehensive privacy analysis❌

Improve testing and error handling❌

Optimize performance and detection accuracy❌

Complete end-to-end integration❌

Prepare the project for production deployment❌

🚧 Status: PriviLens is currently in the prototype/development stage. Features and analysis logic are continuously being improved.

**Feedback and suggestions are welcome!**
