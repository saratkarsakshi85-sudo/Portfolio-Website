(function () {
  const artboard = document.querySelector(".artboard");
  if (!artboard || document.body.classList.contains("home-body")) return;

  const WIDTH = 1440;
  const HEIGHT = 1024;

  function fit() {
    const scale = Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT);
    artboard.style.transform = "scale(" + scale + ")";
  }

  fit();
  window.addEventListener("resize", fit);
})();
