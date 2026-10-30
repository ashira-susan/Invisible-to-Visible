async function collectPermissions() {

    const permissions = [
        "camera",
        "microphone",
        "geolocation",
        "notifications"
    ];

    let results = {};

    for (const permission of permissions) {

        try {

            const status = await navigator.permissions.query({
                name: permission
            });

            results[permission] = status.state;

        } catch (error) {

            results[permission] = "unsupported";

        }

    }

    return {
        signal: "permissions",

        permissions: results,

        timestamp: new Date().toISOString()
    };

}


window.collectPermissions = collectPermissions;