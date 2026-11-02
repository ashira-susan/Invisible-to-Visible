# ============================================================
# PriviLens X
# Knowledge Base
# ============================================================

# ============================================================
# COOKIE DATABASE
# ============================================================

COOKIE_DATABASE = {

    "_ga":{

        "owner":"Google",

        "category":"Analytics",

        "purpose":"Distinguishes unique visitors.",

        "risk":"Medium",

        "explanation":
        "Google Analytics uses this cookie to identify returning visitors and generate website usage statistics."

    },

    "_gid":{

        "owner":"Google",

        "category":"Analytics",

        "purpose":"Stores visitor session.",

        "risk":"Low",

        "explanation":
        "This cookie groups user activity within a single browsing session."

    },

    "_gat":{

        "owner":"Google",

        "category":"Analytics",

        "purpose":"Limits request rate.",

        "risk":"Low",

        "explanation":
        "Used to reduce the amount of data sent to Google Analytics."

    },

    "session-id":{

        "owner":"Amazon",

        "category":"Essential",

        "purpose":"Maintains user login session.",

        "risk":"Low",

        "explanation":
        "Required to keep you signed into your Amazon account."

    },

    "session-token":{

        "owner":"Amazon",

        "category":"Security",

        "purpose":"Authentication",

        "risk":"Low",

        "explanation":
        "Protects your login session and verifies your identity."

    },

    "_fbp":{

        "owner":"Meta",

        "category":"Advertising",

        "purpose":"Facebook Advertising",

        "risk":"Medium",

        "explanation":
        "Helps Facebook measure advertising performance."

    },

    "_gcl_au":{

        "owner":"Google",

        "category":"Advertising",

        "purpose":"Google Ads Conversion",

        "risk":"Medium",

        "explanation":
        "Measures advertisement conversions."

    }

}

# ============================================================
# TRACKER DATABASE
# ============================================================

TRACKER_DATABASE={

    "Google Analytics":{

        "company":"Google",

        "purpose":"Website Analytics",

        "risk":"Medium",

        "collects":[

            "Page Views",

            "Clicks",

            "Session Duration",

            "Browser",

            "Language",

            "Device"

        ]

    },

    "Google Tag Manager":{

        "company":"Google",

        "purpose":"Manage website tags",

        "risk":"Medium",

        "collects":[

            "Events",

            "Clicks",

            "Marketing Tags"

        ]

    },

    "Meta Pixel":{

        "company":"Meta",

        "purpose":"Advertising",

        "risk":"Medium",

        "collects":[

            "Purchases",

            "Page Visits",

            "Ad Clicks"

        ]

    },

    "Amazon Ads":{

        "company":"Amazon",

        "purpose":"Advertising",

        "risk":"Medium",

        "collects":[

            "Shopping Behaviour",

            "Clicks"

        ]

    }

}

# ============================================================
# NETWORK DATABASE
# ============================================================

NETWORK_DATABASE={

    "google-analytics.com":{

        "company":"Google",

        "purpose":"Analytics",

        "risk":"Medium"

    },

    "googletagmanager.com":{

        "company":"Google",

        "purpose":"Tag Management",

        "risk":"Medium"

    },

    "facebook.net":{

        "company":"Meta",

        "purpose":"Advertising",

        "risk":"Medium"

    },

    "cloudfront.net":{

        "company":"Amazon",

        "purpose":"Content Delivery Network",

        "risk":"Low"

    }

}