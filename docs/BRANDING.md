# Branding & theming

This project is **open-core**: the entire application — including the
end-to-end encryption — lives in this public repository so the cryptography is
**auditable, not just trusted**. Visual branding is isolated in a small,
swappable layer so a private theme (proprietary logos and commercially licensed
fonts) can be applied **without forking the code**.

## How it works

All brand-specific values live under `frontend/src/brand/`:

```
frontend/src/brand/
├── types.ts            # the Brand contract
├── index.ts            # resolves the active brand (default OR private override)
├── default/            # open, redistributable theme (system fonts, MIT mark)
│   ├── theme.css       # aliases onto shadcn tokens (src/index.css)
│   ├── Emblem.tsx      # original MIT padlock mark
│   └── index.tsx       # name, tagline, wordmark, footer links
└── private/            # OPTIONAL proprietary overlay — git-ignored
    ├── theme.css       # @font-face + token overrides
    ├── assets/…        # licensed fonts + logos (NOT published)
    └── index.tsx       # exports `brand`
```

`brand/index.ts` uses Vite's `import.meta.glob` to look for
`./private/index.tsx`. If that folder exists, its `brand` (and its `theme.css`)
takes over; if it does not, the open default is used. A missing `private/`
folder never breaks the build.

Nothing else in the app references a specific brand: `App.tsx` renders
`brand.Wordmark`, reads `brand.name` / `brand.tagline` / `brand.footerLinks`,
and the UI reads shadcn CSS variables (`--background`, `--foreground`,
`--primary`, `--font-sans`, …) from `frontend/src/index.css`. Toggle dark mode
with the `dark` class on `<html>` (and `data-theme` for older overlays).

## Public repo (this one)

- Ships **only** the open default theme — system fonts, an original MIT padlock
  mark, and a matching tab icon (`frontend/public/favicon.svg`).
- Tab and home-screen icons are that same padlock (`frontend/public/favicon.svg`
  and `frontend/public/apple-touch-icon.svg`), not a private lockup.
- Contains **no** proprietary fonts or logos, so it is safe to publish and fully
  self-contained: `git clone … && cargo run` builds and runs the neutral build.
- `frontend/src/brand/private/` is listed in `.gitignore`, so licensed assets
  can never be committed here by accident.

## Private theme (your fork)

Keep a **private** repository/fork that adds `frontend/src/brand/private/`:

1. Add your fonts under `frontend/src/brand/private/assets/fonts/` and logos
   under `…/assets/logos/`.
2. Create `frontend/src/brand/private/theme.css` with your `@font-face`
   declarations and `:root` / `.dark` token overrides (shadcn variables).
3. Create `frontend/src/brand/private/index.tsx` exporting a `Brand`
   (name, tagline, `Wordmark`, footer links).
4. Optional: add `favicon.svg` / `favicon.ico` / `apple-touch-icon.png` next to
   that file if the tab icon should not be the default Tresorpost padlock.
5. Build normally — the overlay is picked up automatically.

Because the overlay is a self-contained folder, staying in sync with the public
project is just:

```bash
git remote add upstream https://github.com/dol-ch/tresorpost.git
git fetch upstream
git merge upstream/main      # feature work lives outside brand/private, so this stays conflict-free
```

### Reference: the DOL overlay

`frontend/src/brand/private/theme.css`:

```css
@font-face { font-family: "Euclid Flex"; font-weight: 600;
  src: url("./assets/fonts/EuclidFlex-Semibold.otf") format("opentype"); }
/* … Euclid Circular B (400/500), Euclid Mono … */

:root {
  --background: #ffffff; --foreground: #111111;
  --primary: #2e5d50; --primary-foreground: #fafaf7;
  --font-sans: "Euclid Circular B", sans-serif;
  --font-heading: "Euclid Flex", sans-serif;
  --font-mono: "Euclid Mono", ui-monospace, monospace;
}
.dark {
  --background: #111111; --foreground: #fafaf7;
  --primary: #8fbeb0; --primary-foreground: #111111;
}
```

`frontend/src/brand/private/index.tsx`:

```tsx
import "./theme.css";
import type { Brand } from "../types";
import lockup from "./assets/logos/dol-lockup-white.svg";

export const brand: Brand = {
  name: "DOL",
  tagline: "Encrypted · Quantum-safe · Self-destructing",
  Wordmark: () => <img src={lockup} alt="DOL" />,
  footerLinks: [
    { label: "dol.ch", href: "https://dol.ch" },
    { label: "dol.contact", href: "https://dol.contact" },
  ],
};
```

## Licensing note

The MIT `LICENSE` covers **source code only**. Proprietary logos/wordmarks and
commercially licensed fonts (e.g. Euclid) are **not** covered and are **not**
included in the public repository. Keep them in your private overlay.
