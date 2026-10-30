function collectScripts() {

    const scripts = Array.from(document.scripts);

    return {
        signal: "scripts",

        count: scripts.length,

        sources: scripts.map(script => {
            return script.src || "inline-script";
        }),

        timestamp: new Date().toISOString()
    };

}


window.collectScripts = collectScripts;