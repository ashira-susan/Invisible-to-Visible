console.clear();

console.log("========== PriviLens Detector ==========");

async function runDetector() {

    // ======================================
    // WEBSITE INFORMATION
    // ======================================

    const signal = {

        website: {
            url: window.location.href,
            domain: window.location.hostname,
            title: document.title,
            referrer: document.referrer
        },

        evidence: {}

    };

    // ======================================
    // COLLECT INVISIBLE DATA
    // ======================================

    signal.evidence.cookies = collectCookies();
    signal.evidence.storage = collectStorage();
    signal.evidence.scripts = collectScripts();
    signal.evidence.trackers = collectTrackers();
    signal.evidence.permissions = await collectPermissions();
    signal.evidence.fingerprint = collectFingerprint();
    signal.evidence.requests = collectRequests();
    signal.evidence.headers = collectHeaders();
    signal.evidence.network = collectNetwork();

    // ======================================
    // DISPLAY RESULT
    // ======================================

    console.log("Website Information");
    console.log(signal.website);

    console.log("Collected Evidence");
    console.log(signal.evidence);

    // ======================================
    // SEND TO BACKEND
    // ======================================

    console.log("Sending message to background...");

    chrome.runtime.sendMessage(
        {
            type: "ANALYZE",
            data: signal
        },
        (response) => {

            if (chrome.runtime.lastError) {
                console.error("Runtime Error:", chrome.runtime.lastError.message);
                return;
            }

            console.log("========== BACKEND RESPONSE ==========");
            console.log(response);

        }
    );

}

// ======================================
// START DETECTOR
// ======================================

runDetector();