function collectTrackers() {

    const scripts = Array.from(document.scripts);

    const trackerPatterns = [
        "google-analytics",
        "googletagmanager",
        "facebook.net",
        "doubleclick",
        "hotjar"
    ];

    const detectedTrackers = scripts
        .map(script => script.src)
        .filter(src =>
            trackerPatterns.some(pattern =>
                src.includes(pattern)
            )
        );

    return {
        signal: "trackers",

        count: detectedTrackers.length,

        trackers: detectedTrackers,

        timestamp: new Date().toISOString()
    };

}


window.collectTrackers = collectTrackers;