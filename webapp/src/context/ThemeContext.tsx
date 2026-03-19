import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "tc-theme";

function resolveEffective(pref: ThemePreference): "light" | "dark" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

// Apply theme immediately (before React renders) to prevent flash
const _initialPref = (localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? "system";
document.documentElement.classList.toggle("dark", resolveEffective(_initialPref) === "dark");

interface ThemeContextValue {
  preference: ThemePreference;
  effective: "light" | "dark";
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(_initialPref);
  const [effective, setEffective] = useState<"light" | "dark">(() => resolveEffective(_initialPref));

  function setPreference(pref: ThemePreference) {
    localStorage.setItem(STORAGE_KEY, pref);
    const eff = resolveEffective(pref);
    setPreferenceState(pref);
    setEffective(eff);
    document.documentElement.classList.toggle("dark", eff === "dark");
  }

  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange(e: MediaQueryListEvent) {
      const eff: "light" | "dark" = e.matches ? "dark" : "light";
      setEffective(eff);
      document.documentElement.classList.toggle("dark", eff === "dark");
    }
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, [preference]);

  return (
    <ThemeContext.Provider value={{ preference, effective, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
