"use client";
import { Icon } from "./ui";
import { useTheme } from "@/lib/client/theme";

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
  const label = theme === "dark" ? "Dunkel" : theme === "light" ? "Hell" : "System";
  return (
    <button className="btn btn-ghost btn-sm" onClick={() => setTheme(next)} title={`Darstellung: ${label} (klicken zum Wechseln)`} aria-label={`Darstellung wechseln, aktuell ${label}`}>
      <Icon name={theme === "light" ? "sun" : "moon"} size={16} />
      {!compact && label}
    </button>
  );
}
