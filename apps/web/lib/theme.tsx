"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Theme controller: `light`, `dark`, or `system`.
 *
 * Deliberately dependency-free (no next-themes): the resolved value is applied by toggling the
 * `dark` class on `<html>`, and an inline script in the root layout sets it before first paint so
 * there is never a flash of the wrong theme. The design tokens in globals.css do the rest — the
 * whole app re-skins from that single class.
 */

export type Theme = "light" | "dark" | "system";
export type Resolved = "light" | "dark";

const STORAGE_KEY = "orbita-theme";

const matchesDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

function resolve(theme: Theme): Resolved {
  return theme === "system" ? (matchesDark() ? "dark" : "light") : theme;
}

function apply(resolved: Resolved) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

const ThemeContext = createContext<{
  theme: Theme;
  resolved: Resolved;
  setTheme: (next: Theme) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Both sides of hydration must render the same tree, so the stored theme is *not* read during
  // init (that caused an aria-checked mismatch in ThemeToggle). The inline script in the root
  // layout already paints the right theme; this effect only syncs React state to match, one
  // microtask before the browser paints, so there is still no flash.
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolved, setResolved] = useState<Resolved>("light");

  useEffect(() => {
    let stored: Theme = "system";
    try {
      stored = (window.localStorage.getItem(STORAGE_KEY) as Theme) || "system";
    } catch {
      /* storage disabled — stay on the default the boot script already applied */
    }
    const next = resolve(stored);
    setThemeState(stored);
    setResolved(next);
    apply(next);
    // Intentionally no deps: run once; live updates come from setTheme below.
  }, []);
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode / storage disabled — the in-memory theme still applies */
    }
  }, []);

  // Follow the OS live while in `system` mode.
  useEffect(() => {
    const next = resolve(theme);
    setResolved(next);
    apply(next);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = resolve("system");
      setResolved(r);
      apply(r);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const value = useMemo(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
