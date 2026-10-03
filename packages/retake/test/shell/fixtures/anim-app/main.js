// #pop adds `in` to the pill: a transform and an opacity transition start together.
// #go adds `in` to the hero (each word runs `rise`); #tick starts the ticker:
// element.animate(), four keyframes, 2000ms after a 200ms delay, ease-in-out.
document.querySelector("#go").addEventListener("click", () => document.querySelector(".hero").classList.add("in"))
document.querySelector("#tick").addEventListener("click", () => {
  document.querySelector(".ticker").animate(
    [
      { offset: 0, transform: "translateX(0px)" },
      { offset: 0.3, transform: "translateX(300px)" },
      { offset: 0.6, transform: "translateX(300px) rotate(0deg)" },
      { offset: 1, transform: "translateX(0px) rotate(90deg)" },
    ],
    { duration: 2000, delay: 200, easing: "ease-in-out", fill: "none" },
  )
})
document.querySelector("#pop").addEventListener("click", () => document.querySelector(".pill").classList.add("in"))
