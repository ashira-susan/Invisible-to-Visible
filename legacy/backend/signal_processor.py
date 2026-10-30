# ==========================================================
# PriviLens X
# Signal Processor
# Invisible Data → Visible Data Architecture
# ==========================================================


def process_signal(signal: dict):

    processed = {}


    # ==========================================
    # Website Information
    # ==========================================

    website = signal.get("website", {})

    processed["url"] = website.get("url", "")

    processed["domain"] = website.get("domain", "")

    processed["title"] = website.get("title", "")

    processed["referrer"] = website.get("referrer", "")



    # ==========================================
    # Evidence Layer
    # ==========================================

    evidence = signal.get("evidence", {})



    # ==========================================
    # Cookies
    # ==========================================

    cookies = evidence.get("cookies", {})

    processed["cookies"] = cookies.get("count", 0)



    # ==========================================
    # Storage
    # ==========================================

    storage = evidence.get("storage", {})

    processed["localStorage"] = storage.get(
        "localStorageCount",
        0
    )

    processed["sessionStorage"] = storage.get(
        "sessionStorageCount",
        0
    )



    # ==========================================
    # Scripts
    # ==========================================

    scripts = evidence.get("scripts", {})

    processed["scripts"] = scripts.get("count", 0)



    # ==========================================
    # Trackers
    # ==========================================

    trackers = evidence.get("trackers", {})

    processed["trackers"] = trackers.get("trackers", [])



    # ==========================================
    # Permissions
    # ==========================================

    permissions = evidence.get(
        "permissions",
        []
    )

    processed["permissions"] = permissions



    # ==========================================
    # Fingerprint
    # ==========================================

    fingerprint = evidence.get(
        "fingerprint",
        {}
    )


    processed["browser"] = fingerprint.get(
        "userAgent",
        "Unknown"
    )

    processed["platform"] = fingerprint.get(
        "platform",
        "Unknown"
    )

    processed["language"] = fingerprint.get(
        "language",
        "Unknown"
    )

    processed["timezone"] = fingerprint.get(
        "timezone",
        "Unknown"
    )

    processed["screenWidth"] = fingerprint.get(
        "screenWidth",
        0
    )

    processed["screenHeight"] = fingerprint.get(
        "screenHeight",
        0
    )

    processed["colorDepth"] = fingerprint.get(
        "colorDepth",
        0
    )

    processed["cpuCores"] = fingerprint.get(
        "cpuCores",
        "Unknown"
    )

    processed["deviceMemory"] = fingerprint.get(
        "deviceMemory",
        "Unknown"
    )

    # ==========================================
    # Headers
    # ==========================================

    headers = evidence.get("headers", {})

    processed["https"] = headers.get("https", False)

    processed["origin"] = headers.get("origin", "")



    # ==========================================
    # Headers
    # ==========================================

    headers = evidence.get("headers", {})

    processed["https"] = headers.get("https", False)


    # ==========================================
    # Network
    # ==========================================

    processed["network"] = evidence.get(
        "network",
        {}
    )
    headers = evidence.get("headers", {})

    processed["https"] = headers.get("https", False)



    # ==========================================
    # Statistics
    # ==========================================

    processed["trackerCount"] = len(processed["trackers"])

    processed["cookieCount"] = processed["cookies"]


    processed["storageTotal"] = (
        processed["localStorage"]
        +
        processed["sessionStorage"]
    )



    # ==========================================
    # Referrer Type
    # ==========================================

    if processed["referrer"] == "":

        processed["referrerType"] = "Direct Visit"

    else:

        processed["referrerType"] = "Referral"



    # ==========================================
    # Fingerprint Score
    # ==========================================

    fingerprint_score = 0


    if processed["browser"] != "Unknown":
        fingerprint_score += 10

    if processed["platform"] != "Unknown":
        fingerprint_score += 10

    if processed["language"] != "Unknown":
        fingerprint_score += 5

    if processed["timezone"] != "Unknown":
        fingerprint_score += 5


    if processed["screenWidth"] > 0:
        fingerprint_score += 10

    if processed["screenHeight"] > 0:
        fingerprint_score += 10


    if processed["cpuCores"] != "Unknown":
        fingerprint_score += 10


    if processed["deviceMemory"] != "Unknown":
        fingerprint_score += 10


    if processed["colorDepth"] > 0:
        fingerprint_score += 10


    processed["fingerprintScore"] = fingerprint_score



    if fingerprint_score >= 70:

        processed["fingerprintRisk"] = "High"

    elif fingerprint_score >= 40:

        processed["fingerprintRisk"] = "Medium"

    else:

        processed["fingerprintRisk"] = "Low"



    # ==========================================
    # Permission Summary
    # ==========================================

    permission_summary = {}


    for item in permissions:

        try:

            permission_summary[item["permission"]] = item["state"]

        except Exception:

            pass


    processed["permissionSummary"] = permission_summary



    # ==========================================
    # AI Metadata
    # ==========================================

    processed["analysisReady"] = True

    processed["analysisVersion"] = "PriviLens AI v3"


    return processed