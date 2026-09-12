import "./theme.css";
import type { Brand } from "../types";
import { Emblem } from "./Emblem";

function Wordmark() {
    return (
        <span className="wordmark">
      <Emblem />
      <span className="wordmark-text">Tresorpost</span>
    </span>
    );
}

export const brand: Brand = {
    name: "Tresorpost",
    tagline: "Encrypted · Self-destructing",
    Wordmark,
    footerLinks: [
        {
            label: "source",
            href: "https://github.com/dol-ch/tresorpost",
        },
    ],
};
