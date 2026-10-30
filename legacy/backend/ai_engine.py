# ==========================================================
# PriviLens X
# AI ENGINE
# ==========================================================

from cookie_explainer import explain_cookies
from tracker_explainer import explain_trackers
from network_explainer import explain_domains


def generate_ai_report(signal):

    report = []

    # =====================================================
    # WEBSITE
    # =====================================================

    report.append(
        f"🌐 Website analysed: {signal['domain']}"
    )

    # =====================================================
    # HTTPS
    # =====================================================

    if signal.get("https", False):

        report.append(
            "✅ This website uses HTTPS encryption. Data exchanged with the server is encrypted during transmission."
        )

    else:

        report.append(
            "⚠ This website is not using HTTPS. Information transmitted may be vulnerable to interception."
        )

    # =====================================================
    # COOKIE SUMMARY
    # =====================================================

    report.append(
        f"🍪 Total Cookies Detected: {signal['cookieCount']}"
    )

    cookie_details = explain_cookies(
        signal.get("cookieNames", [])
    )

    if len(cookie_details) == 0:

        report.append(
            "No identifiable cookies were detected."
        )

    else:

        report.append(
            "Cookie Intelligence:"
        )

        for cookie in cookie_details:

            report.append(

                f"• {cookie['name']}"

            )

            report.append(

                f"Owner: {cookie['owner']}"

            )

            report.append(

                f"Purpose: {cookie['purpose']}"

            )

            report.append(

                f"Risk: {cookie['risk']}"

            )

    # =====================================================
    # TRACKERS
    # =====================================================

    tracker_details = explain_trackers(
        signal.get("trackers", [])
    )

    if len(tracker_details) == 0:

        report.append(
            "✅ No known trackers detected."
        )

    else:

        report.append(
            "Tracker Intelligence:"
        )

        for tracker in tracker_details:

            report.append(

                f"• {tracker['name']}"

            )

            report.append(

                f"Company: {tracker['company']}"

            )

            report.append(

                f"Purpose: {tracker['purpose']}"

            )

            report.append(

                f"Risk: {tracker['risk']}"

            )

            report.append(

                tracker["explanation"]

            )

    # =====================================================
    # NETWORK
    # =====================================================

    network_details = explain_domains(

        signal.get("networkDomains", [])

    )

    if len(network_details):

        report.append(

            "Network Connections:"

        )

        for domain in network_details:

            report.append(

                f"• {domain['domain']}"

            )

            report.append(

                f"Company: {domain['company']}"

            )

            report.append(

                f"Purpose: {domain['purpose']}"

            )

    # =====================================================
    # STORAGE
    # =====================================================

    report.append(
        f"📦 Cookies: {signal['cookieCount']}"
    )

    report.append(

        f"📂 Local Storage Items: {signal['localStorage']}"

    )

    report.append(

        f"🗂 Session Storage Items: {signal['sessionStorage']}"

    )

    # =====================================================
    # BROWSER FINGERPRINT
    # =====================================================

    report.append("")

    report.append("Browser Fingerprint")

    report.append(

        f"Browser: {signal['browser']}"

    )

    report.append(

        f"Platform: {signal['platform']}"

    )

    report.append(

        f"Language: {signal['language']}"

    )

    report.append(

        f"Timezone: {signal['timezone']}"

    )

    report.append(

        f"Resolution: {signal['screenWidth']} x {signal['screenHeight']}"

    )

    report.append(

        f"CPU Cores: {signal['cpuCores']}"

    )

    report.append(

        f"Device Memory: {signal['deviceMemory']} GB"

    )

    report.append(

        f"Fingerprint Score: {signal['fingerprintScore']}/80"

    )

    report.append(

        f"Fingerprint Risk: {signal['fingerprintRisk']}"

    )

    # =====================================================
    # PERMISSIONS
    # =====================================================

    if len(signal.get("permissions", [])):

        report.append("")
        report.append("Browser Permissions")

        for permission in signal["permissions"]:

            # If permission is a dictionary
            if isinstance(permission, dict):

                report.append(
                    f"{permission.get('permission', 'Unknown')} : {permission.get('state', 'Unknown')}"
                )

            # If permission is just a string
            else:

                report.append(str(permission))
    # =====================================================
    # AI CONCLUSION
    # =====================================================

    report.append("")

    report.append("AI Privacy Summary")

    if signal["fingerprintRisk"] == "High":

        report.append(
            "Your browser exposes a high amount of identifying information. Websites may be able to recognise you across browsing sessions."
        )

    elif signal["fingerprintRisk"] == "Medium":

        report.append(
            "Your browser exposes a moderate amount of identifying information. Consider enabling stronger privacy protections."
        )

    else:

        report.append(
            "Your browser exposes relatively little identifying information compared with a typical browser configuration."
        )

    if signal["trackerCount"] > 0:

        report.append(
            f"This website uses {signal['trackerCount']} known tracking technology(ies). They are commonly used for analytics or advertising."
        )

    else:

        report.append(
            "No known third-party trackers were identified during this scan."
        )

    report.append(
        "This analysis is based on information that is observable from the browser. Some server-side tracking techniques cannot be detected from the client side."
    )

    return report