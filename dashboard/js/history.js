// =========================================
// LOAD WEBSITE HISTORY
// =========================================

async function loadHistory() {

    const container = document.getElementById("historyContainer");

    container.innerHTML = "Loading...";

    try {

        const response = await fetch("http://127.0.0.1:8000/history");

        const history = await response.json();

        if (history.length === 0) {

            container.innerHTML = "<h3>No websites analysed yet.</h3>";

            return;
        }

        container.innerHTML = "";

        history.forEach(item => {

            const card = document.createElement("div");

            card.className = "history-card";

            card.innerHTML = `

                <h2>🌐 ${item.website}</h2>

                <p><strong>🛡 Trust Score:</strong> ${item.trust_score}</p>

                <p><strong>⚠ Risk Level:</strong> ${item.risk_level}</p>

                <p><strong>🍪 Cookies:</strong> ${item.cookies}</p>

                <p><strong>👁 Trackers:</strong> ${item.trackers.length}</p>

                <p><strong>🔒 HTTPS:</strong> ${item.https}</p>

                <p><strong>🕒 Time:</strong> ${item.time}</p>

            `;

            container.appendChild(card);

        });

    }

    catch (error) {

        console.error(error);

        container.innerHTML = "<h3>Unable to load history.</h3>";

    }

}

loadHistory();