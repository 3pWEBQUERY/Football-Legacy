"use client";
/** Einstellungen: KI-Funktionen (Claude) ein- oder ausschalten, mit Hinweis zu den übermittelten Daten. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Switch } from "@/components/Switch";
import { useToast } from "@/components/ui";

export function AiSettings() {
  const toast = useToast();
  const [st, setSt] = useState<{ configured: boolean; enabled: boolean; model: string; used: number; limit: number } | null>(null);
  const load = () => api<any>("account/ai").then(setSt).catch(() => setSt(null));
  useEffect(() => { load(); }, []);
  if (!st) return null;
  async function toggle(v: boolean) {
    try {
      await api("account/settings", { body: { ai: v } });
      toast(v ? "KI-Funktionen eingeschaltet" : "KI-Funktionen ausgeschaltet", "success");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  return (
    <>
      <div className="settings-row">
        <div>
          <b>KI-Funktionen ({st.model})</b>
          <div className="faint small">Eigene Antworten in der Pressekonferenz, Spielberichte von Claude und der Co-Trainer-Chat</div>
        </div>
        <Switch label="KI-Funktionen" checked={st.enabled} disabled={!st.configured} onChange={toggle} />
      </div>
      <p className="faint small" style={{ margin: "8px 0 0" }}>
        {st.configured
          ? <>Eingeschaltet werden Spieldaten deiner Karriere und deine eigenen Texte an Anthropic (USA) übermittelt, um die Antworten zu erzeugen – keine E-Mail-Adresse, kein Passwort. Höchstens {st.limit} Anfragen pro Tag (heute {st.used}). Details in der <Link href="/datenschutz">Datenschutzerklärung</Link>.</>
          : "Auf diesem Server ist noch kein Zugang zu Claude eingerichtet."}
      </p>
    </>
  );
}
