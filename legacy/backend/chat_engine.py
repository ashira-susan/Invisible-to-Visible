# ==========================================================
# PriviLens X
# AI Chat Engine
# ==========================================================

from cookie_explainer import explain_cookies
from tracker_explainer import explain_trackers
from network_explainer import explain_domains


class ChatEngine:

    def __init__(self):
        pass

    # ======================================================
    # MAIN CHAT FUNCTION
    # ======================================================

    def ask(self, question: str, signal: dict):

        question = question.lower().strip()

        # ==========================================
        # WEBSITE SAFETY
        # ==========================================

        if "safe" in question or "trust" in question:

            return self.website_safety(signal)

        # ==========================================
        # COOKIES
        # ==========================================

        elif "cookie" in question:

            return self.cookie_analysis(signal)

        # ==========================================
        # TRACKERS
        # ==========================================

        elif "tracker" in question:

            return self.tracker_analysis(signal)

        # ==========================================
        # NETWORK
        # ==========================================

        elif "network" in question or "domain" in question:

            return self.network_analysis(signal)

        # ==========================================
        # FINGERPRINT
        # ==========================================

        elif "fingerprint" in question:

            return self.fingerprint_analysis(signal)

        # ==========================================
        # PERMISSIONS
        # ==========================================

        elif "permission" in question:

            return self.permission_analysis(signal)

        # ==========================================
        # DEFAULT
        # ==========================================

        return (
            "I can answer questions about:\n\n"
            "• Website Safety\n"
            "• Cookies\n"
            "• Trackers\n"
            "• Network Connections\n"
            "• Browser Fingerprinting\n"
            "• Permissions"
        )

    # ======================================================
    # WEBSITE SAFETY
    # ======================================================

    def website_safety(self, signal):

        message = ""

        if signal.get("https"):

            message += "✅ HTTPS encryption is enabled.\n\n"

        else:

            message += "⚠ HTTPS is NOT enabled.\n\n"

        tracker_count = signal.get("trackerCount", 0)

        if tracker_count == 0:

            message += "✅ No known trackers detected.\n\n"

        else:

            message += f"⚠ {tracker_count} tracker(s) detected.\n\n"

        risk = signal.get("fingerprintRisk", "Unknown")

        message += f"Browser Fingerprint Risk : {risk}\n\n"

        if risk == "High":

            message += (
                "Your browser exposes a high amount of identifying "
                "information."
            )

        elif risk == "Medium":

            message += (
                "Your browser exposes a moderate amount of identifying "
                "information."
            )

        else:

            message += (
                "Your browser currently exposes a relatively low amount "
                "of identifying information."
            )

        return message

    # ======================================================
    # COOKIE ANALYSIS
    # ======================================================

    def cookie_analysis(self, signal):

        cookies = explain_cookies(

            signal.get("cookieNames", [])

        )

        if len(cookies) == 0:

            return "No known cookies detected."

        text = "Cookie Analysis\n\n"

        for cookie in cookies:

            text += f"🍪 {cookie['name']}\n"

            text += f"Owner : {cookie['owner']}\n"

            text += f"Purpose : {cookie['purpose']}\n"

            text += f"Risk : {cookie['risk']}\n\n"

        return text

    # ======================================================
    # TRACKER ANALYSIS
    # ======================================================

    def tracker_analysis(self, signal):

        trackers = explain_trackers(

            signal.get("trackers", [])

        )

        if len(trackers) == 0:

            return "No known trackers detected."

        text = "Tracker Analysis\n\n"

        for tracker in trackers:

            text += f"🔍 {tracker['name']}\n"

            text += f"Company : {tracker['company']}\n"

            text += f"Purpose : {tracker['purpose']}\n"

            text += f"Risk : {tracker['risk']}\n\n"

        return text

    # ======================================================
    # NETWORK ANALYSIS
    # ======================================================

    def network_analysis(self, signal):

        domains = explain_domains(

            signal.get("networkDomains", [])

        )

        if len(domains) == 0:

            return "No external network domains detected."

        text = "Network Analysis\n\n"

        for domain in domains:

            text += f"🌐 {domain['domain']}\n"

            text += f"Company : {domain['company']}\n"

            text += f"Purpose : {domain['purpose']}\n"

            text += f"Risk : {domain['risk']}\n\n"

        return text

    # ======================================================
    # FINGERPRINT
    # ======================================================

    def fingerprint_analysis(self, signal):

        return (
            f"Fingerprint Score : {signal.get('fingerprintScore', 0)}/80\n\n"
            f"Risk : {signal.get('fingerprintRisk', 'Unknown')}\n\n"
            "Browser fingerprinting uses details such as your browser, "
            "screen resolution, timezone, language and hardware "
            "information to recognise your device."
        )

    # ======================================================
    # PERMISSIONS
    # ======================================================

    def permission_analysis(self, signal):

        permissions = signal.get("permissions", [])

        if len(permissions) == 0:

            return "No browser permissions detected."

        text = "Browser Permissions\n\n"

        for permission in permissions:

            text += (
                f"{permission['permission']} : "
                f"{permission['state']}\n"
            )

        return text


# ==========================================================
# GLOBAL INSTANCE
# ==========================================================

chat_engine = ChatEngine()
# ==========================================================
# PUBLIC FUNCTION
# ==========================================================

def generate_chat_response(question: str, signal: dict):

    return chat_engine.ask(question, signal)