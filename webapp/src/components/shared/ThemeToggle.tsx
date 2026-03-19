import { useTheme, type ThemePreference } from "../../context/ThemeContext";

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  { value: "light",  label: "Light mode",  icon: <SunIcon /> },
  { value: "system", label: "System mode", icon: <MonitorIcon /> },
  { value: "dark",   label: "Dark mode",   icon: <MoonIcon /> },
];

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const currentIndex = OPTIONS.findIndex((o) => o.value === preference);
  const current = OPTIONS[currentIndex];
  const next = OPTIONS[(currentIndex + 1) % OPTIONS.length];

  return (
    <button
      onClick={() => setPreference(next.value)}
      aria-label={`Switch to ${next.label}`}
      className="h-7 w-7 rounded-full flex items-center justify-center transition-all"
      style={{
        background: "var(--tc-input-bg)",
        border: "1px solid var(--tc-input-border)",
        color: "#F59E0B",
      }}
    >
      {current.icon}
    </button>
  );
}
