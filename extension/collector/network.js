function collectNetwork() {

    const connection =
        navigator.connection ||
        navigator.mozConnection ||
        navigator.webkitConnection;

    return {
        signal: "network",

        online: navigator.onLine,

        connectionType: connection
            ? connection.effectiveType
            : "unknown",

        downlink: connection
            ? connection.downlink
            : "unknown",

        timestamp: new Date().toISOString()
    };

}


window.collectNetwork = collectNetwork;