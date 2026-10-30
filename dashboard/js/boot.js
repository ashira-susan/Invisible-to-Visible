/* =======================================================
   PriviLens X Boot Sequence
======================================================= */

const progressFill = document.querySelector(".progressFill");
const percentage = document.querySelector(".percentage");
const message = document.getElementById("bootMessage");

const bootSteps = [

    { progress: 10, text: "Initializing AI Security Engine..." },

    { progress: 25, text: "Loading Neural Network..." },

    { progress: 45, text: "Scanning Browser Environment..." },

    { progress: 65, text: "Checking Cookies & Trackers..." },

    { progress: 80, text: "Building Digital Twin..." },

    { progress: 92, text: "Preparing Mission Control..." },

    { progress: 100, text: "Launch Complete ✓" }

];

let currentStep = 0;

function updateBoot(){

    if(currentStep >= bootSteps.length){

        setTimeout(()=>{

            window.location.href="dashboard.html";

        },1000);

        return;

    }

    const step = bootSteps[currentStep];

    progressFill.style.width = step.progress + "%";

    percentage.innerText = step.progress + "%";

    message.innerText = step.text;

    currentStep++;

    setTimeout(updateBoot,900);

}

updateBoot();