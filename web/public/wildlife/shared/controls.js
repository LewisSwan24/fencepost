import { config } from "./config.js";
export function initControls() {
  const selectable = () =>
    [
      ...(document.querySelector("dialog[open]") || document).querySelectorAll(
        document.querySelector("dialog[open]")
          ? "button"
          : "main a,main button,main summary,.bottom-nav a",
      ),
    ].filter(
      (e) =>
        !e.disabled &&
        e.getClientRects().length &&
        !e.closest("details:not([open]) *:not(summary)"),
    );
  let selected = null;
  function focus(el) {
    document.querySelectorAll(".macro-focus").forEach((x) => {
      x.classList.remove("macro-focus");
      x.removeAttribute("data-selected");
    });
    selected = el;
    if (el) {
      el.classList.add("macro-focus");
      el.setAttribute("data-selected", "Selected");
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest" });
    }
  }
  function refresh() {
    const items = selectable();
    if (!items.includes(selected)) focus(items[0]);
  }
  function next() {
    const items = selectable();
    focus(items[(items.indexOf(selected) + 1) % items.length]);
  }
  function back() {
    window.speechSynthesis?.cancel();
    const dialog = document.querySelector("dialog[open]");
    if (dialog) {
      dialog.close();
      dialog.remove();
      refresh();
      return;
    }
    const detail = document.querySelector("details[open]");
    if (detail) {
      detail.open = false;
      focus(detail.querySelector("summary"));
      return;
    }
    const name = location.pathname.split("/").pop();
    if (name === "species.html") location.href = "animals.html";
    else if (name !== "index.html" && name !== "") location.href = "index.html";
  }
  function choose() {
    refresh();
    selected?.click();
  }
  const actions = { back, choose, next };
  document
    .querySelectorAll("[data-control]")
    .forEach((b) =>
      b.addEventListener("click", () => actions[b.dataset.control]()),
    );
  document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const action = Object.keys(config.keys).find(
      (k) => config.keys[k] === e.key,
    );
    if (action) {
      e.preventDefault();
      actions[action]();
    } else if (
      config.volume.mode === "software" &&
      [config.volume.increase, config.volume.decrease].includes(e.key)
    ) {
      e.preventDefault();
      setVolume(
        volume +
          (e.key === config.volume.increase
            ? config.volume.step
            : -config.volume.step),
      );
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (selectable().includes(e.target.closest("a,button,summary")))
      focus(e.target.closest("a,button,summary"));
  });
  let volume = Number(sessionStorage.getItem("wn-volume") ?? 0.7);
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v)));
    sessionStorage.setItem("wn-volume", String(volume));
    document.querySelectorAll("audio").forEach((a) => (a.volume = volume));
    document.dispatchEvent(new CustomEvent("wn-volume", { detail: volume }));
    const status = document.querySelector("#volume-state");
    if (status) {
      status.textContent = `Audio volume ${Math.round(volume * 100)}%`;
      clearTimeout(status.timer);
      status.timer = setTimeout(() => (status.textContent = ""), 2500);
    }
  }
  window.addEventListener("wn-knob", (e) => {
    if (config.volume.mode === "software" && Number.isFinite(e.detail?.delta))
      setVolume(volume + e.detail.delta * config.volume.step);
  });
  let idle;
  function resetIdle() {
    clearTimeout(idle);
    idle = setTimeout(() => {
      window.speechSynthesis?.cancel();
      document.querySelectorAll("dialog[open]").forEach((d) => {
        d.close();
        d.remove();
      });
      document.querySelectorAll("audio").forEach((a) => {
        a.pause();
        a.currentTime = 0;
      });
      if (
        !location.pathname.endsWith("index.html") &&
        !location.pathname.endsWith("/")
      )
        location.replace("index.html");
      else {
        document.dispatchEvent(new Event("wn-idle"));
        focus(selectable()[0]);
      }
    }, config.idleMs);
  }
  ["pointerdown", "pointermove", "keydown", "touchstart", "scroll"].forEach(
    (evt) => window.addEventListener(evt, resetIdle, { passive: true }),
  );
  new MutationObserver(refresh).observe(document.querySelector("main"), {
    childList: true,
    subtree: true,
  });
  refresh();
  resetIdle();
  return { refresh, getVolume: () => volume };
}
