def calculate_trust_score(signal):

    score = 100
    reasons = []

    # ==========================
    # HTTPS
    # ==========================

    if signal.get("https"):
        reasons.append("HTTPS connection is secure")
    else:
        score -= 30
        reasons.append("Website is NOT using HTTPS")

    # ==========================
    # Cookies
    # ==========================

    cookies = signal.get("cookies", {})

    if isinstance(cookies, dict):
        cookies = cookies.get("count", 0)

    if cookies >= 20:
        score -= 15
        reasons.append(f"High number of cookies ({cookies})")

    elif cookies >= 10:
        score -= 8
        reasons.append(f"Moderate cookies ({cookies})")

    else:
        reasons.append(f"Low cookies ({cookies})")

    # ==========================
    # Local Storage
    # ==========================

    local_storage = signal.get("localStorage", 0)

    if local_storage >= 20:
        score -= 12
        reasons.append(f"Heavy Local Storage ({local_storage})")

    elif local_storage >= 10:
        score -= 6
        reasons.append(f"Moderate Local Storage ({local_storage})")

    else:
        reasons.append("Minimal Local Storage")

    # ==========================
    # Session Storage
    # ==========================

    session_storage = signal.get("sessionStorage", 0)

    if session_storage >= 15:
        score -= 8
        reasons.append(f"Heavy Session Storage ({session_storage})")

    elif session_storage >= 5:
        score -= 4
        reasons.append(f"Moderate Session Storage ({session_storage})")

    else:
        reasons.append("Minimal Session Storage")

    # ==========================
    # Loaded Scripts
    # ==========================

    scripts = signal.get("scripts", {})

    if isinstance(scripts, dict):
        scripts = scripts.get("count", 0)

    if scripts >= 30:
        score -= 15
        reasons.append(f"Very Script Heavy ({scripts})")

    elif scripts >= 15:
        score -= 8
        reasons.append(f"Several Scripts ({scripts})")

    else:
        reasons.append(f"Few Scripts ({scripts})")

    # ==========================
    # Trackers
    # ==========================

    trackers = signal.get("trackers", {})

    if isinstance(trackers, dict):

        tracker_count = trackers.get("count", 0)

        tracker_names = trackers.get("trackers", [])

    else:

        tracker_names = trackers

        tracker_count = len(trackers)

    if tracker_count > 0:

        deduction = min(tracker_count * 10, 40)

        score -= deduction

        reasons.append(
            f"{tracker_count} Known Tracker(s): {', '.join(tracker_names)}"
        )

    else:

        reasons.append("No Known Trackers Detected")

    # ==========================
    # Clamp Score
    # ==========================

    score = max(0, min(score, 100))

    # ==========================
    # Risk Level
    # ==========================

    if score >= 85:
        risk = "Low"

    elif score >= 60:
        risk = "Medium"

    else:
        risk = "High"

    # ==========================
    # AI Summary
    # ==========================

    if risk == "Low":
        summary = "Website appears trustworthy with low privacy risk."

    elif risk == "Medium":
        summary = "Website shows moderate privacy concerns."

    else:
        summary = "Website presents significant privacy risks."

    return {

        "trust_score": score,

        "risk_level": risk,

        "summary": summary,

        "reasons": reasons

    }