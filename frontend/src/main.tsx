import "./brand/layers.css"; // must be first: locks theme.base < theme.override
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./brand"; // loads the active theme's CSS (default open theme or private override)
import "./styles.css";
import "./product.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(<App />);
