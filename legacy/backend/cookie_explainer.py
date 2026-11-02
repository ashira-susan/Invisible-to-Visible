# ============================================================
# PriviLens X
# Cookie Explainer
# ============================================================

from knowledge_base import COOKIE_DATABASE


# ============================================================
# EXPLAIN ONE COOKIE
# ============================================================

def explain_cookie(cookie_name: str):

    cookie = COOKIE_DATABASE.get(cookie_name)

    if cookie:

        return {

            "name": cookie_name,

            "owner": cookie["owner"],

            "category": cookie["category"],

            "purpose": cookie["purpose"],

            "risk": cookie["risk"],

            "explanation": cookie["explanation"]

        }

    return {

        "name": cookie_name,

        "owner": "Unknown",

        "category": "Unknown",

        "purpose": "No information available.",

        "risk": "Unknown",

        "explanation":
        "PriviLens does not yet have information about this cookie."

    }


# ============================================================
# EXPLAIN MULTIPLE COOKIES
# ============================================================

def explain_cookies(cookie_list):

    results = []

    for cookie in cookie_list:

        if isinstance(cookie, dict):

            cookie_name = cookie.get("name", "")

        else:

            cookie_name = str(cookie)

        results.append(

            explain_cookie(cookie_name)

        )

    return results