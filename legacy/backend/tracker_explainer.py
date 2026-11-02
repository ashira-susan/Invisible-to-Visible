# ============================================================
# PriviLens X
# Tracker Explainer
# ============================================================

from knowledge_base import TRACKER_DATABASE


# ============================================================
# EXPLAIN ONE TRACKER
# ============================================================

def explain_tracker(tracker_name: str):

    tracker = TRACKER_DATABASE.get(tracker_name)

    if tracker:

        return {

            "name": tracker_name,

            "company": tracker["company"],

            "purpose": tracker["purpose"],

            "risk": tracker["risk"],

            "collects": tracker["collects"],

            "explanation":

                f"{tracker_name} is operated by "

                f"{tracker['company']} and is mainly used "

                f"for {tracker['purpose'].lower()}. "

                "It may collect behavioural information "

                "such as page views, clicks, browser "

                "details and session activity."

        }

    return {

        "name": tracker_name,

        "company": "Unknown",

        "purpose": "Unknown",

        "risk": "Unknown",

        "collects": [],

        "explanation":

            "PriviLens currently has no information "

            "about this tracker."

    }


# ============================================================
# EXPLAIN MULTIPLE TRACKERS
# ============================================================

def explain_trackers(tracker_list):

    result = []

    for tracker in tracker_list:

        result.append(

            explain_tracker(tracker)

        )

    return result