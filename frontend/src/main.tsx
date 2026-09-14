import "./index.css";
import "./brand/layers.css"; // must be first after tokens: locks theme.base < theme.override
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./brand"; // loads the active theme's CSS (default open theme or private override)

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(<App />);
