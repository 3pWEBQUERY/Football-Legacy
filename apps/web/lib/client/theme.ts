"use client";
import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "dark" | "light";

export function applyTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem("fl-theme", choice);
  } catch {}
  const dark = choice === "system" ? !matchMedia("(prefers-color-scheme: light)").matches : choice === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>("dark");
  useEffect(() => {
    try {
      setTheme((localStorage.getItem("fl-theme") as ThemeChoice) || "dark");
    } catch {}
  }, []);
  return [theme, (t) => { setTheme(t); applyTheme(t); }];
}
