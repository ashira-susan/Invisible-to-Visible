/* =======================================================
   PriviLens X
   Login Page
======================================================= */

/* ===========================================
   Mouse Glow Effect
=========================================== */

const mouseGlow = document.querySelector(".mouseGlow");

document.addEventListener("mousemove", (e) => {

    if (!mouseGlow) return;

    mouseGlow.style.left = e.clientX + "px";

    mouseGlow.style.top = e.clientY + "px";

});


/* ===========================================
   3D Glass Card Effect
=========================================== */

const loginCard = document.querySelector(".loginCard");

document.addEventListener("mousemove", (e) => {

    if (!loginCard) return;

    const rect = loginCard.getBoundingClientRect();

    const x = e.clientX - rect.left;

    const y = e.clientY - rect.top;

    const rotateY = (x - rect.width / 2) / 35;

    const rotateX = -(y - rect.height / 2) / 35;

    loginCard.style.transform =

        `perspective(1000px)
        rotateX(${rotateX}deg)
        rotateY(${rotateY}deg)`;

});


document.addEventListener("mouseleave", () => {

    if (!loginCard) return;

    loginCard.style.transform =

        "perspective(1000px) rotateX(0deg) rotateY(0deg)";

});


/* ===========================================
   Show / Hide Password
=========================================== */

const passwordInput = document.getElementById("password");

const togglePassword = document.querySelector(".togglePassword");

if (togglePassword && passwordInput) {

    togglePassword.addEventListener("click", () => {

        if (passwordInput.type === "password") {

            passwordInput.type = "text";

            togglePassword.textContent = "🙈";

        }

        else {

            passwordInput.type = "password";

            togglePassword.textContent = "👁";

        }

    });

}


/* ===========================================
   AI Shield Pulse
=========================================== */

const shield = document.querySelector(".shieldCore");

setInterval(() => {

    if (!shield) return;

    shield.classList.toggle("pulse");

}, 1800);
/* =======================================================
   LOGIN API
======================================================= */

const loginForm = document.getElementById("loginForm");

const rememberMe = document.getElementById("rememberMe");

loginForm.addEventListener("submit", async (e) => {

    e.preventDefault();

    const email = document.getElementById("email").value.trim();

    const password = document.getElementById("password").value;

    const loginButton = document.querySelector(".loginButton");

    loginButton.disabled = true;

    loginButton.innerHTML = "Authenticating...";

    try{

        const response = await fetch(

            "http://127.0.0.1:8000/auth/login",

            {

                method:"POST",

                headers:{

                    "Content-Type":"application/json"

                },

                body:JSON.stringify({

                    email,

                    password

                })

            }

        );

        const data = await response.json();

        if(response.ok){

            // Save JWT Token
            localStorage.setItem(

                "access_token",

                data.access_token

            );

            // Save User Details
            localStorage.setItem(

                "user",

                JSON.stringify(data.user)

            );

            // Remember Email
            if(rememberMe.checked){

                localStorage.setItem(

                    "remember_email",

                    email

                );

            }else{

                localStorage.removeItem(

                    "remember_email"

                );

            }

            alert("Login Successful 🚀");

            window.location.href="boot.html";

        }

        else{

            alert(data.detail);

        }

    }

    catch(error){

        console.error(error);

        alert("Unable to connect to server.");

    }

    finally{

        loginButton.disabled=false;

        loginButton.innerHTML="Access Mission Control →";

    }

});
/* =======================================================
   REMEMBER EMAIL
======================================================= */

window.addEventListener("load",()=>{

    const savedEmail=

        localStorage.getItem("remember_email");

    if(savedEmail){

        document.getElementById("email").value=savedEmail;

        rememberMe.checked=true;

    }

});


/* =======================================================
   INPUT ANIMATION
======================================================= */

const inputs=document.querySelectorAll("input");

inputs.forEach(input=>{

    input.addEventListener("focus",()=>{

        input.parentElement.style.transform="translateY(-3px)";

    });

    input.addEventListener("blur",()=>{

        input.parentElement.style.transform="translateY(0px)";

    });

});


/* =======================================================
   SIMPLE VALIDATION
======================================================= */

passwordInput.addEventListener("input",()=>{

    if(passwordInput.value.length>=8){

        passwordInput.style.borderColor="#22d3ee";

    }

    else{

        passwordInput.style.borderColor="#ef4444";

    }

});