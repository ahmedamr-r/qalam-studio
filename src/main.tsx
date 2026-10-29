// React Grab (development only): pick any element on the page to copy its component and source for an agent.
if (import.meta.env.DEV) {
  import("react-grab");
}
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/geist-mono/index.css";
import "./ui/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";

// A trackpad pinch arrives as a Ctrl-wheel. The canvases zoom on it themselves; anywhere else (a
// side panel, the top bar) the browser would zoom the whole page, so its default is always off.
// Safari sends a pinch as gesture events instead.
window.addEventListener("wheel", (e) => e.ctrlKey && e.preventDefault(), { passive: false });
for (const type of ["gesturestart", "gesturechange"]) document.addEventListener(type, (e) => e.preventDefault());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
