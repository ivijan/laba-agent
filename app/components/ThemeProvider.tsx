"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "studio-nova-theme";

const ThemeContext = createContext<{ toggleTheme: () => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") setTheme(saved);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;

    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      document.documentElement.dataset.theme = theme;
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
  }, [ready, theme]);

  function toggleTheme() {
    const activeTheme =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    setTheme(activeTheme === "dark" ? "light" : "dark");
  }

  return <ThemeContext.Provider value={{ toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeToggle wymaga ThemeProvider.");

  return (
    <button
      type="button"
      className="ghost theme-toggle"
      onClick={context.toggleTheme}
      aria-label="Przełącz jasny lub ciemny motyw"
      title="Przełącz jasny lub ciemny motyw"
    >
      <span aria-hidden="true">◐</span>
      <span>Motyw</span>
    </button>
  );
}
