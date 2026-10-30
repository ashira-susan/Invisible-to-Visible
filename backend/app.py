from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from analyzer import analyze_website
from trust_engine import calculate_trust_score
from signal_processor import process_signal
from ai_engine import generate_ai_report
from auth import router as auth_router

from chat_routes import router as chat_router
from chat_routes import update_latest_signal

from history_manager import save_scan, get_history

app = FastAPI()
# =====================================
# REGISTER ROUTERS
# =====================================

app.include_router(auth_router)
app.include_router(chat_router)

# =====================================
# LATEST ANALYSIS STORAGE
# =====================================

latest_analysis = {

    "website": "Waiting...",
    "trust_score": 0,
    "risk_level": "Unknown",

    "cookies": 0,
    "trackers": [],
    "scripts": 0,
    "https": False,

    # Referrer
    "referrer": "",

    # Browser Fingerprint
    "browser": "",
    "platform": "",
    "language": "",
    "timezone": "",

    "screenWidth": 0,
    "screenHeight": 0,

    "cpuCores": "",
    "deviceMemory": "",

    "colorDepth": 0,

    "fingerprintScore": 0,

    "recommendation": []

}

# =====================================
# ENABLE CORS
# =====================================

app.add_middleware(

    CORSMiddleware,

    allow_origins=["*"],

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"]

)

# =====================================
# SIGNAL MODEL
# =====================================

class Website(BaseModel):

    url: str

    domain: str

    title: str

    referrer: str



class Evidence(BaseModel):

    cookies: dict

    storage: dict

    scripts: dict

    trackers: dict

    permissions: dict | list

    fingerprint: dict

    requests: dict

    headers: dict

    network: dict



class Signal(BaseModel):

    website: Website

    evidence: Evidence
# =====================================
# HOME
# =====================================

@app.get("/")
def home():

    return {

        "message": "PriviLens Backend Running Successfully 🚀"

    }


# =====================================
# WEBSITE ANALYSIS
# =====================================

@app.get("/analyze")
def analyze(url: str):

    analysis = analyze_website(url)

    score = calculate_trust_score(analysis)

    return {

        **analysis,

        **score

    }


# =====================================
# EXTENSION ANALYSIS
# =====================================

@app.post("/analyze")
def analyze_signal(signal: Signal):

    global latest_analysis

    print("\n========== SIGNAL RECEIVED ==========")
    print(f"Website : {signal.website.domain}")
    print(f"Cookies : {signal.evidence.cookies.get('count', 0)}")
    print(f"Scripts : {signal.evidence.scripts.get('count', 0)}")
    print(f"Trackers: {signal.evidence.trackers.get('count', 0)}")

    # -------------------
    # RAW SIGNAL
    # -------------------

    signal_data = signal.model_dump()

    # -------------------
    # PROCESS SIGNAL
    # -------------------

    processed_signal = process_signal(signal_data)
    update_latest_signal(processed_signal)

    print("\n========== PROCESSED SIGNAL ==========")
    print({
        "website": processed_signal.get("domain"),
        "trust_ready": processed_signal.get("analysisReady"),
        "cookies": processed_signal.get("cookieCount"),
        "storage": processed_signal.get("storageTotal"),
        "scripts": processed_signal.get("scripts"),
        "https": processed_signal.get("https")
    })

    # -------------------
    # TRUST ENGINE
    # -------------------

    try:
        trust_analysis = calculate_trust_score(processed_signal)

        print("\n========== TRUST ANALYSIS ==========")
        print(
            f"Score : {trust_analysis['trust_score']} | "
            f"Risk : {trust_analysis['risk_level']}"
        )
    except Exception as e:
        print("TRUST ENGINE ERROR")
        import traceback
        traceback.print_exc()
        raise


    try:
        ai_report = generate_ai_report(processed_signal)

        print("\n========== AI REPORT ==========")
        for line in ai_report:
            print("•", line)

    except Exception as e:
        print("AI ENGINE ERROR")
        import traceback
        traceback.print_exc()

    # -------------------
    # STORE DASHBOARD DATA
    # -------------------

    latest_analysis = {

    "website": signal.website.domain,

    "trust_score": trust_analysis["trust_score"],

    "risk_level": trust_analysis["risk_level"],

    "cookies": signal.evidence.cookies,

    "trackers": signal.evidence.trackers,

    "scripts": signal.evidence.scripts,

    "https": signal.evidence.headers.get("https", False),

    "referrer": signal.website.referrer,

    "browser": signal.evidence.fingerprint.get("userAgent", ""),

    "platform": signal.evidence.fingerprint.get("platform", ""),

    "language": signal.evidence.fingerprint.get("language", ""),

    "timezone": signal.evidence.fingerprint.get("timezone", ""),

    "screenWidth": signal.evidence.fingerprint.get("screen", {}).get("width", 0),

    "screenHeight": signal.evidence.fingerprint.get("screen", {}).get("height", 0),

    "recommendation": ai_report

}
    save_scan(latest_analysis)

    return {

        "status": "success",

        "processed_signal": processed_signal,

        "trust_analysis": trust_analysis,

        "ai_recommendation": ai_report

    }


# =====================================
# LIVE DASHBOARD
# =====================================

@app.get("/dashboard/latest")
def dashboard_latest():

    return latest_analysis
# =====================================
# WEBSITE HISTORY API
# =====================================

@app.get("/history")
def history():

    return get_history()

# =====================================
# START SERVER
# =====================================

if __name__ == "__main__":

    import uvicorn

    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=8000,
        reload=True
    )