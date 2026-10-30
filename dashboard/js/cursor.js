// ======================================================
// PriviLens X
// Cursor Glow Engine
// ======================================================

const cursorGlow = document.querySelector(".cursorGlow");

let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;

let currentX = mouseX;
let currentY = mouseY;

document.addEventListener("mousemove", (e) => {

    mouseX = e.clientX;
    mouseY = e.clientY;

});

function animateCursor() {

    currentX += (mouseX - currentX) * 0.12;
    currentY += (mouseY - currentY) * 0.12;

    cursorGlow.style.left = currentX + "px";
    cursorGlow.style.top = currentY + "px";

    requestAnimationFrame(animateCursor);

}

animateCursor();


// ===============================================
// Grow when hovering interactive elements
// ===============================================

const hoverElements = document.querySelectorAll(
    "a, button, .featureCard, .statCard, .whyCard, .infoCard"
);

hoverElements.forEach((element) => {

    element.addEventListener("mouseenter", () => {

        cursorGlow.classList.add("cursorHover");

    });

    element.addEventListener("mouseleave", () => {

        cursorGlow.classList.remove("cursorHover");

    });

});