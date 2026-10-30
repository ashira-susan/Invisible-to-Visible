function collectFingerprint() {

    return {
        signal: "fingerprint",

        screen: {
            width: window.screen.width,
            height: window.screen.height
        },

        language: navigator.language,

        platform: navigator.platform,

        timezone: Intl.DateTimeFormat()
            .resolvedOptions()
            .timeZone,

        userAgent: navigator.userAgent,

        timestamp: new Date().toISOString()
    };

}


window.collectFingerprint = collectFingerprint;