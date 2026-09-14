import "./theme.css";
import type { Brand } from "../types";
import { Emblem } from "./Emblem";

function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-foreground">
      <Emblem />
      <span className="font-heading text-[15px] font-semibold tracking-tight">
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
      label: "source",
      href: "https://github.com/dol-ch/tresorpost",
    },
  ],
};
