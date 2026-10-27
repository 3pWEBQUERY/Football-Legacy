"use client";
import { useEffect, useState } from "react";
import { saveSoundPrefs, soundPrefs, type SoundPrefs } from "@/lib/client/sound";
import { Switch } from "./Switch";
import { Icon } from "./ui";

/** Stadionton an/aus (pro Gerät). */
export function SoundToggle() {
  const [p, setP] = useState<SoundPrefs | null>(null);
  useEffect(() => setP(soundPrefs()), []);
  if (!p) return null;
  const toggle = () => {
    const next = { ...p, on: !p.on };
    saveSoundPrefs(next);
    setP(next);
  };
  return (
    <button className="btn" onClick={toggle} aria-pressed={p.on} title={p.on ? "Stadionton ausschalten" : "Stadionton einschalten"}>
      <Icon name={p.on ? "sound" : "mute"} size={15} /> {p.on ? "Ton an" : "Ton aus"}
    </button>
  );
}

/** Schalter und Lautstärke für die Einstellungsseite. */
export function SoundSettings() {
  const [p, setP] = useState<SoundPrefs | null>(null);
  useEffect(() => setP(soundPrefs()), []);
  if (!p) return null;
  const update = (next: SoundPrefs) => { saveSoundPrefs(next); setP(next); };
  return (
    <>
      <div className="settings-row">
        <div><b>Stadionton</b><div className="faint small">Zuschauer, Raunen bei Chancen, Torjubel und Pfiffe im Spiel – gilt für dieses Gerät</div></div>
        <Switch label="Stadionton" checked={p.on} onChange={(on) => update({ ...p, on })} />
      </div>
      <div className="settings-row">
        <div><b>Lautstärke</b><div className="faint small">{Math.round(p.volume * 100)} %</div></div>
        <input type="range" min={0} max={100} value={Math.round(p.volume * 100)} disabled={!p.on} aria-label="Lautstärke"
          onChange={(e) => update({ ...p, volume: Number(e.target.value) / 100 })} style={{ width: 180, accentColor: "var(--accent)" }} />
      </div>
    </>
  );
}
