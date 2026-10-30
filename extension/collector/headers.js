function collectHeaders() {

    return {
        signal: "headers",

        https: window.location.protocol === "https:",

        origin: window.location.origin,

        timestamp: new Date().toISOString()
    };

}


window.collectHeaders = collectHeaders;