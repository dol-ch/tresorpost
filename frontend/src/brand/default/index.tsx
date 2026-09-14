import "./theme.css";
import type { Brand } from "../types";
import { Emblem } from "./Emblem";
import { SwissFlag } from "./SwissFlag";

function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-foreground">
      <Emblem />
      <span className="font-heading text-[19px] font-bold tracking-tight">
        Tresorpost
      </span>
    </span>
  );
}

export const brand: Brand = {
  name: "Tresorpost",
  tagline: "Encrypted · Quantum-safe · Self-destructing",
  Wordmark,
  footerLinks: [
    {
      label: "Source code",
      href: "https://github.com/dol-ch/tresorpost",
    },
  ],
  imprint: {
    name: "DOL",
    lines: ["Lucerne, Switzerland"],
    href: "https://www.dol.ch",
  },
  footerCredit: {
    flag: SwissFlag,
    text: "Made with love in Lucerne by",
    linkLabel: "DOL",
    linkHref: "https://www.dol.ch",
  },
};
