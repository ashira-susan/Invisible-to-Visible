function collectRequests() {

    const resources = performance.getEntriesByType("resource");

    return {
        signal: "network_requests",

        count: resources.length,

        urls: resources.map(resource => resource.name),

        timestamp: new Date().toISOString()
    };

}


window.collectRequests = collectRequests;