class LiveAnalysis {

    constructor(containerId) {

        this.container = document.getElementById(containerId);

        this.steps = [

            "Website Loaded",

            "HTTPS Verification",

            "Scanning Cookies",

            "Detecting Trackers",

            "Checking Local Storage",

            "Analysing Browser Fingerprint",

            "Inspecting Network Requests",

            "Calculating Trust Score",

            "Generating AI Report"

        ];

    }

    start(callback) {

        this.container.innerHTML = "";

        let index = 0;

        const timer = setInterval(() => {

            if (index >= this.steps.length) {

                clearInterval(timer);

                if (callback) callback();

                return;

            }

            const row = document.createElement("div");

            row.className = "analysis-row";

            const time = new Date().toLocaleTimeString();

            row.innerHTML = `

                <span class="analysis-time">${time}</span>

                <span class="analysis-icon">✔</span>

                <span class="analysis-text">${this.steps[index]}</span>

            `;

            this.container.appendChild(row);

            this.container.scrollTop = this.container.scrollHeight;

            index++;

        }, 700);

    }

}