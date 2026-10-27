import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/geist-mono/index.css";
import "./ui/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
