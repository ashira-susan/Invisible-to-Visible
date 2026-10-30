function collectCookies() {

    const cookies = document.cookie
        ? document.cookie.split(";")
        : [];

    return {
        signal: "cookies",

        count: cookies.length,

        names: cookies.map(cookie => {
            return cookie.split("=")[0].trim();
        }),

        timestamp: new Date().toISOString()
    };
}


window.collectCookies = collectCookies;