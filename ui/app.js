// Moves the website slot around; Neeko keeps the page on top of it.
for (let button of document.querySelectorAll("[data-layout]")) {
  button.addEventListener("click", () => {
    document.body.dataset.layout = button.dataset.layout;
  });
}
