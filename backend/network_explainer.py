# ============================================================
# PriviLens X
# Network Explainer
# ============================================================

from knowledge_base import NETWORK_DATABASE


# ============================================================
# EXPLAIN ONE NETWORK DOMAIN
# ============================================================

def explain_domain(domain: str):

    info = NETWORK_DATABASE.get(domain)

    if info:

        return {

            "domain": domain,

            "company": info["company"],

            "purpose": info["purpose"],

            "risk": info["risk"],

            "explanation":

                f"{domain} belongs to "

                f"{info['company']} and is mainly used "

                f"for {info['purpose'].lower()}. "

                "This connection is commonly observed "

                "on many modern websites."

        }

    return {

        "domain": domain,

        "company": "Unknown",

        "purpose": "Unknown",

        "risk": "Unknown",

        "explanation":

            "PriviLens currently has no information "

            "about this domain."

    }


# ============================================================
# EXPLAIN MULTIPLE DOMAINS
# ============================================================

def explain_domains(domain_list):

    results = []

    for domain in domain_list:

        results.append(

            explain_domain(domain)

        )

    return results