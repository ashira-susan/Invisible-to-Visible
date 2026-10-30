/* ==========================================================
   PRIVILENS DASHBOARD
========================================================== */

const API_URL = "http://127.0.0.1:8000/dashboard/latest";

/* ==========================================================
   LOAD DASHBOARD
========================================================== */

async function loadDashboard() {

    try {

        const response = await fetch(API_URL);

        const data = await response.json();

        console.log("Dashboard Data:", data);

        updateDashboard(data);

    }

    catch (error) {

        console.error("Dashboard Error:", error);

    }

}

/* ==========================================================
   UPDATE DASHBOARD
========================================================== */

function updateDashboard(data) {

    // Website
    document.getElementById("websiteName").innerText =
        data.website || "Unknown";

    // Trust Score
    document.getElementById("trustScore").innerText =
        data.trust_score + "%";

    // Cookies
    document.getElementById("cookieCount").innerText =
        data.cookies;

    // Trackers
    document.getElementById("trackerCount").innerText =
        data.trackers.length;

    // HTTPS
    document.getElementById("httpsStatus").innerText =
        data.https ? "YES" : "NO";

    // Risk
    document.getElementById("riskLevel").innerText =
        data.risk_level;

    // Fingerprint
    document.getElementById("fingerprintScore").innerText =
        data.fingerprintScore;

    document.getElementById("fingerprintRisk").innerText =
        data.fingerprintScore + "/100";

    // AI Summary
    document.getElementById("summaryText").innerHTML =
        data.recommendation.join("<br><br>");

}

/* ==========================================================
   AUTO REFRESH
========================================================== */

loadDashboard();

setInterval(loadDashboard, 2000);