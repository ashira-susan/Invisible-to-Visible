// ======================================================
// PriviLens X
// Landing Page Engine
// ======================================================

// ===============================
// Floating Navbar
// ===============================

const navbar = document.getElementById("navbar");

window.addEventListener("scroll", () => {

    if (window.scrollY > 80) {

        navbar.classList.add("navbarScrolled");

    } else {

        navbar.classList.remove("navbarScrolled");

    }

});


// ===============================
// Smooth Scroll
// ===============================

document.querySelectorAll('a[href^="#"]').forEach(anchor => {

    anchor.addEventListener("click", function(e){

        e.preventDefault();

        const target = document.querySelector(this.getAttribute("href"));

        if(target){

            target.scrollIntoView({

                behavior:"smooth",

                block:"start"

            });

        }

    });

});