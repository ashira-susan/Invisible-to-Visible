document.addEventListener("DOMContentLoaded", async () => {

    try {

        const response = await fetch(
            "http://127.0.0.1:8000/dashboard/latest"
        );

        const data = await response.json();

        document.getElementById("website").textContent =
            data.website || "Unknown";

        document.getElementById("score").textContent =
            `${data.trust_score}/100 (${data.risk_level})`;

    }

    catch (error) {

        console.error(error);

        document.getElementById("website").textContent =
            "Backend Offline";

        document.getElementById("score").textContent =
            "--";

    }

});
document.getElementById("viewReport").addEventListener("click", () => {

    chrome.tabs.create({
        url: "http://127.0.0.1:8000/dashboard/latest"
    });

});
