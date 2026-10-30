/* =======================================================
   PriviLens X
   Signup Page
======================================================= */

/* ===========================================
   Mouse Glow Effect
=========================================== */

const mouseGlow = document.querySelector(".mouseGlow");

document.addEventListener("mousemove", (e) => {

    mouseGlow.style.left = e.clientX + "px";

    mouseGlow.style.top = e.clientY + "px";

});


/* ===========================================
   Floating Card Effect
=========================================== */

const signupCard = document.querySelector(".signupCard");

document.addEventListener("mousemove", (e) => {

    const rect = signupCard.getBoundingClientRect();

    const x = e.clientX - rect.left;

    const y = e.clientY - rect.top;

    const rotateY = (x - rect.width / 2) / 30;

    const rotateX = -(y - rect.height / 2) / 30;

    signupCard.style.transform =
        `perspective(1000px)
         rotateX(${rotateX}deg)
         rotateY(${rotateY}deg)`;

});


document.addEventListener("mouseleave", () => {

    signupCard.style.transform =
        "perspective(1000px) rotateX(0deg) rotateY(0deg)";

});


/* ===========================================
   AI Core Glow
=========================================== */

const aiCore = document.querySelector(".core");

setInterval(() => {

    aiCore.classList.toggle("pulse");

}, 2000);
/* =======================================================
   PASSWORD VISIBILITY
======================================================= */

const togglePassword = document.querySelector(".togglePassword");

const passwordInput = document.getElementById("password");

if (togglePassword && passwordInput) {

    togglePassword.addEventListener("click", () => {

        if (passwordInput.type === "password") {

            passwordInput.type = "text";

            togglePassword.textContent = "🙈";

        } else {

            passwordInput.type = "password";

            togglePassword.textContent = "👁";

        }

    });

}


/* =======================================================
   PASSWORD VALIDATION
======================================================= */

const confirmPasswordInput = document.getElementById("confirmPassword");

function validatePasswords() {

    if (!passwordInput || !confirmPasswordInput) return;

    if (confirmPasswordInput.value === "") {

        confirmPasswordInput.style.borderColor = "transparent";

        return;

    }

    if (passwordInput.value === confirmPasswordInput.value) {

        confirmPasswordInput.style.borderColor = "#22d3ee";

    } else {

        confirmPasswordInput.style.borderColor = "#ef4444";

    }

}

passwordInput.addEventListener("input", validatePasswords);

confirmPasswordInput.addEventListener("input", validatePasswords);


/* =======================================================
   FORM VALIDATION
======================================================= */

const signupForm = document.getElementById("signupForm");

signupForm.addEventListener("submit", function (e) {

    if (passwordInput.value !== confirmPasswordInput.value) {

        e.preventDefault();

        alert("Passwords do not match!");

        confirmPasswordInput.focus();

        return;

    }

});
/* =======================================================
   SIGNUP API
======================================================= */

signupForm.addEventListener("submit", async function (e) {

    e.preventDefault();

    if (passwordInput.value !== confirmPasswordInput.value) {

        alert("Passwords do not match!");

        return;

    }

    const userData = {

        name: document.getElementById("name").value,

        email: document.getElementById("email").value,

        password: passwordInput.value

    };

    try {

        const response = await fetch(

            "http://127.0.0.1:8000/auth/signup",

            {

                method: "POST",

                headers: {

                    "Content-Type": "application/json"

                },

                body: JSON.stringify(userData)

            }

        );

        const data = await response.json();

        if (response.ok) {

            alert("🎉 Account created successfully!");

            window.location.href = "login.html";

        }

        else {

            alert(data.detail || "Signup Failed");

        }

    }

    catch (error) {

        console.error(error);

        alert("Unable to connect to the server.");

    }

});
/* =======================================================
   PREMIUM LOADING BUTTON
======================================================= */

const signupButton = document.querySelector(".signupButton");

signupForm.addEventListener("submit", async function () {

    signupButton.disabled = true;

    signupButton.innerHTML = "Creating Account...";

});


/* =======================================================
   INPUT ANIMATION
======================================================= */

const inputs = document.querySelectorAll("input");

inputs.forEach(input => {

    input.addEventListener("focus", () => {

        input.parentElement.style.transform = "translateY(-2px)";

    });

    input.addEventListener("blur", () => {

        input.parentElement.style.transform = "translateY(0px)";

    });

});


/* =======================================================
   PAGE ENTRY ANIMATION
======================================================= */

window.addEventListener("load", () => {

    document.body.style.opacity = "1";

});


/* =======================================================
   AI CORE HOVER EFFECT
======================================================= */

const core = document.querySelector(".core");

core.addEventListener("mouseenter", () => {

    core.style.transform =
        "translate(-50%,-50%) scale(1.15)";

});

core.addEventListener("mouseleave", () => {

    core.style.transform =
        "translate(-50%,-50%) scale(1)";

});