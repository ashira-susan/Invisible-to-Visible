console.log("Background JS Loaded");
console.log("Background.js Loaded Successfully");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    console.log("MESSAGE RECEIVED:", message);

    if (message.type === "ANALYZE") {

        console.log("Signal received from detector");

        fetch("http://127.0.0.1:8000/analyze", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(message.data)

        })

        .then(async (response) => {

            console.log("Backend HTTP Status:", response.status);

            const text = await response.text();

            console.log("Backend Raw Response:");
            console.log(text);

            try {

                const data = JSON.parse(text);

                console.log("Backend JSON:", data);

                sendResponse(data);


            } catch (e) {

                console.error("Backend returned NON-JSON:");
                console.error(text);

                sendResponse({
                    status: "error",
                    message: text
                });

            }

        })

        .catch((error) => {

            console.error("Backend Connection Error:", error);

            sendResponse({
                status: "error",
                message: error.toString()
            });

        });

        return true;
    }

});