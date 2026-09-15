import { Moon, Sun } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export type Theme = "light" | "dark";

export function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("et_theme", theme);
  } catch {
    /* ignore */
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const next: Theme = theme === "light" ? "dark" : "light";
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      title={`Switch to ${next} theme`}
      aria-label="Toggle theme"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
    >
      {theme === "light" ? <Moon /> : <Sun />}
    </Button>
  );
}
