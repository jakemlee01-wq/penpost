import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { normalizeAreaIds } from "./lib/areas";
import { areas } from "./lib/content";
import { setAreaNormalizer } from "./lib/storage";
import "./styles/app.css";

setAreaNormalizer((ids) => normalizeAreaIds(ids, areas));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
