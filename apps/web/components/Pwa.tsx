"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import {
  canInstall, currentSubscription, disablePush, enablePush, isIos, isStandalone, onPwaChange, promptInstall, pushSupported, registerServiceWorker,
} from "@/lib/client/pwa";
import { Switch } from "./Switch";
import { useToast } from "./ui";

/** Einmal im Root-Layout: Service Worker registrieren. */
export function PwaRegister() {
  useEffect(() => registerServiceWorker(), []);
  return null;
}

function useInstallState() {
  const [, force] = useState(0);
  useEffect(() => onPwaChange(() => force((n) => n + 1)), []);
  return { installed: isStandalone(), installable: canInstall(), ios: isIos() };
}

/** Kleiner Knopf "Als App installieren" (nur wenn der Browser es anbietet). */
export function InstallButton({ className = "btn" }: { className?: string }) {
  const s = useInstallState();
  if (s.installed || !s.installable) return null;
  return <button className={className} onClick={() => promptInstall()}>App installieren</button>;
}

interface Status { devices: number; subscribed: boolean; topics: string[]; available: Record<string, { label: string; text: string }> }

/** Einstellungen: App installieren, Push-Mitteilungen und Themen. */
export function AppSettings() {
  const toast = useToast();
  const inst = useInstallState();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = ready && pushSupported();

  async function load() {
    const sub = await currentSubscription().catch(() => null);
    const s = await api<Status>(`push/status${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ""}`).catch(() => null);
    setStatus(s ? { ...s, subscribed: s.subscribed && !!sub } : null);
  }
  useEffect(() => { setReady(true); load(); }, []);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok, "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const topics = status?.topics ?? Object.keys(status?.available ?? {});

  return (
    <>
      <div className="settings-row">
        <div>
          <b>Als App installieren</b>
          <div className="faint small">
            {inst.installed ? "Football Legacy läuft als installierte App."
              : inst.installable ? "Eigenes Symbol auf dem Startbildschirm, Vollbild ohne Browserleiste."
              : inst.ios ? "Auf dem iPhone: Teilen-Symbol antippen, dann „Zum Home-Bildschirm“."
              : "Im Browsermenü „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ wählen."}
          </div>
        </div>
        {inst.installed ? <span className="badge badge-accent">Installiert</span> : inst.installable && <button className="btn btn-primary" onClick={() => promptInstall()}>Installieren</button>}
      </div>
      <div className="settings-row">
        <div>
          <b>Push-Mitteilungen</b>
          <div className="faint small">
            {!ready ? "…" : !supported ? (inst.ios && !inst.installed ? "Auf dem iPhone erst die App installieren, dann lassen sich Mitteilungen einschalten." : "Dieser Browser unterstützt keine Push-Mitteilungen.")
              : status?.subscribed ? `Auf diesem Gerät aktiv${status.devices > 1 ? ` · ${status.devices} Geräte insgesamt` : ""}` : "Benachrichtigungen auf diesem Gerät, auch wenn das Spiel geschlossen ist."}
          </div>
        </div>
        <Switch label="Push-Mitteilungen" checked={!!status?.subscribed} disabled={!supported || busy}
          onChange={(on) => run(() => (on ? enablePush(topics) : disablePush()), on ? "Push-Mitteilungen eingeschaltet" : "Push-Mitteilungen ausgeschaltet")} />
      </div>
      {status?.subscribed && Object.entries(status.available).map(([key, t]) => (
        <div className="settings-row" key={key} style={{ paddingLeft: 14 }}>
          <div><b>{t.label}</b><div className="faint small">{t.text}</div></div>
          <Switch label={t.label} checked={status.topics.includes(key)} disabled={busy}
            onChange={(on) => run(() => enablePush(on ? [...status.topics, key] : status.topics.filter((x) => x !== key)))} />
        </div>
      ))}
      {status?.subscribed && (
        <div className="settings-row">
          <div className="faint small">Kommt keine Mitteilung an, prüfe die Mitteilungs-Einstellungen des Geräts.</div>
          <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api("push/test", { method: "POST", body: {} }), "Testmitteilung gesendet")}>Test senden</button>
        </div>
      )}
    </>
  );
}
