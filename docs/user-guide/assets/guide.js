(() => {
  "use strict";
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const panels = [...document.querySelectorAll('[role="tabpanel"]')];
  const navigations = [...document.querySelectorAll("[data-toc-for]")];
  const menu = document.querySelector(".guide-menu");
  const narrow = window.matchMedia("(max-width:820px)");
  let observer;

  const hashTarget = () => {
    try { return document.getElementById(decodeURIComponent(window.location.hash.slice(1))); }
    catch { return null; }
  };

  function observeSections(panel) {
    observer?.disconnect();
    const navigation = navigations.find(item => item.dataset.tocFor === panel.id);
    const links = [...navigation.querySelectorAll("a")];
    links.forEach((link, index) => index === 0 ? link.setAttribute("aria-current", "location") : link.removeAttribute("aria-current"));
    if (!("IntersectionObserver" in window)) return;
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach(link => {
          if (decodeURIComponent(link.hash.slice(1)) === entry.target.id) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      }
    }, { rootMargin: "-5% 0px -65% 0px" });
    panel.querySelectorAll("[data-guide-section]").forEach(heading => observer.observe(heading));
  }

  function activate(id, updateAddress = false) {
    const panel = panels.find(item => item.id === id);
    if (!panel) return;
    tabs.forEach(tab => {
      const active = tab.getAttribute("aria-controls") === id;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach(item => { item.hidden = item !== panel; });
    navigations.forEach(item => { item.hidden = item.dataset.tocFor !== id; });
    const currentTab = tabs.find(tab => tab.getAttribute("aria-controls") === id);
    document.getElementById("toc-label").textContent = `${currentTab.textContent} 목차`;
    document.querySelector("[data-current-guide]").textContent = currentTab.textContent;
    observeSections(panel);
    if (updateAddress) {
      try { window.history.replaceState(null, "", `#${id}`); } catch { /* Navigation also works where history is restricted. */ }
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      const id = tab.getAttribute("aria-controls");
      activate(id, true);
      if (narrow.matches) {
        menu.open = false;
        const heading = document.querySelector(`#${id} .chapter-title`);
        heading.focus({ preventScroll: true });
        heading.scrollIntoView?.({ block: "start", behavior: "instant" });
      }
    });
    tab.addEventListener("keydown", event => {
      const next = event.key === "ArrowDown" ? (index + 1) % tabs.length : event.key === "ArrowUp" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
      if (next === null) return;
      event.preventDefault();
      activate(tabs[next].getAttribute("aria-controls"), true);
      tabs[next].focus();
    });
  });

  document.querySelectorAll("[data-section-link]").forEach(link => link.addEventListener("click", () => {
    if (narrow.matches) menu.open = false;
    document.getElementById(decodeURIComponent(link.hash.slice(1)))?.focus({ preventScroll: true });
  }));
  document.getElementById("print").addEventListener("click", () => window.print());
  if (narrow.matches) menu.open = false;
  narrow.addEventListener("change", event => { menu.open = !event.matches; });
  window.addEventListener("hashchange", () => activate(hashTarget()?.closest('[role="tabpanel"]')?.id));
  document.body.classList.add("guide-ready");
  const initialTarget = hashTarget();
  activate(initialTarget?.closest('[role="tabpanel"]')?.id ?? panels[0]?.id);
  initialTarget?.scrollIntoView?.({ block: "start", behavior: "instant" });
})();
