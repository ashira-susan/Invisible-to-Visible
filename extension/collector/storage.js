function collectStorage() {

    return {
        signal: "storage",

        localStorageCount: localStorage.length,

        sessionStorageCount: sessionStorage.length,

        localStorageKeys: Object.keys(localStorage),

        sessionStorageKeys: Object.keys(sessionStorage),

        timestamp: new Date().toISOString()
    };

}


window.collectStorage = collectStorage;