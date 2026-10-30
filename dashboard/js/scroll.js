// ======================================================
// PriviLens X
// Scroll Reveal Engine
// ======================================================

const revealElements = document.querySelectorAll(

".featureCard,\
.browserCard,\
.whyCard,\
.step,\
.infoCard,\
.mockCard,\
.statCard,\
.faqCard,\
.ctaSection"

);

const observer = new IntersectionObserver(

(entries)=>{

entries.forEach(entry=>{

if(entry.isIntersecting){

entry.target.classList.add("show");

}

});

},

{

threshold:0.15

}

);

revealElements.forEach(element=>{

element.classList.add("hidden");

observer.observe(element);

});