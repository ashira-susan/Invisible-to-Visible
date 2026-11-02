/* ==========================================================
   PRIVILENS AI CHAT
   PART 1
   DOM REFERENCES
========================================================== */

// Chat Area
const chatBox = document.getElementById("chatBox");

// Input Box
const questionInput = document.getElementById("question");

// Send Button
const sendButton = document.getElementById("sendButton");

// Clear Button
const clearButton = document.getElementById("clearChat");

// Suggested Questions
const suggestionButtons =
    document.querySelectorAll(".suggestion");



/* ==========================================================
   EVENT LISTENERS
========================================================== */

// Send Button
sendButton.addEventListener("click", sendMessage);


// Enter Key

questionInput.addEventListener("keydown", function(event){

    if(event.key === "Enter" && !event.shiftKey){

        event.preventDefault();

        sendMessage();

    }

});



async function sendMessage() {

    const message = questionInput.value.trim();

    if (message === "") return;

    // User Message
    addUserMessage(message);

    // Clear Input
    questionInput.value = "";

    // Thinking Animation
    showThinking();

    try {

        const response = await fetch("http://127.0.0.1:8000/chat", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                question: message
            })

        });

        // Backend Error
        if (!response.ok) {

            throw new Error("Server Error");

        }

        const data = await response.json();

        console.log("Backend Response:", data);

        removeThinking();

        // Safety check
        if (data.answer) {

            addAIMessage(data.answer);

        } else {

            addAIMessage("AI returned an empty response.");

        }

    }

    catch (error) {

        console.error(error);

        removeThinking();

        addAIMessage("Unable to connect to PriviLens AI.");

    }

}/* ==========================================================
   USER MESSAGE
========================================================== */

function addUserMessage(message){

    const messageDiv = document.createElement("div");

    messageDiv.className = "message";

    messageDiv.innerHTML = `

        <div class="avatar user">

            👤

        </div>

        <div class="bubble">

            <p>${message}</p>

        </div>

    `;

    chatBox.appendChild(messageDiv);

    scrollToBottom();

}/* ==========================================================
   AUTO SCROLL
========================================================== */

function scrollToBottom(){

    chatBox.scrollTop = chatBox.scrollHeight;

}/* ==========================================================
   AI THINKING MESSAGE
========================================================== */

function showThinking(){

    const thinkingDiv = document.createElement("div");

    thinkingDiv.className = "message ai-message thinking";

    thinkingDiv.id = "thinkingMessage";

    thinkingDiv.innerHTML = `

        <div class="avatar ai">

            🤖

        </div>

        <div class="bubble">

            <p>Thinking...</p>

        </div>

    `;

    chatBox.appendChild(thinkingDiv);

    scrollToBottom();

}/* ==========================================================
   REMOVE THINKING
========================================================== */

function removeThinking(){

    const thinking = document.getElementById("thinkingMessage");

    if(thinking){

        thinking.remove();

    }

}/* ==========================================================
   AI MESSAGE
========================================================== */

function addAIMessage(message){

    const messageDiv = document.createElement("div");

    messageDiv.className = "message ai-message";

    messageDiv.innerHTML = `

        <div class="avatar ai">

            🤖

        </div>

        <div class="bubble">

            <p>${message}</p>

        </div>

    `;

    chatBox.appendChild(messageDiv);

    scrollToBottom();

}