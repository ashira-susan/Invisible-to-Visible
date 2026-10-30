// ======================================================
// PriviLens X
// Particle Background Engine
// ======================================================

const particleContainer = document.getElementById("particles");

const PARTICLE_COUNT = 80;

for (let i = 0; i < PARTICLE_COUNT; i++) {

    const particle = document.createElement("div");

    particle.classList.add("particle");

    particle.style.left = Math.random() * 100 + "%";

    particle.style.top = Math.random() * 100 + "%";

    particle.style.animationDuration =
        6 + Math.random() * 10 + "s";

    particle.style.animationDelay =
        Math.random() * 6 + "s";

    particle.style.opacity =
        0.2 + Math.random() * 0.8;

    particle.style.width =
        2 + Math.random() * 5 + "px";

    particle.style.height =
        particle.style.width;

    particleContainer.appendChild(particle);

}