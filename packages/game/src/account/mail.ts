/**
 * E-Mail-Versand über Resend (https://resend.com). Konfiguration per Umgebung:
 *   RESEND_API_KEY  API-Schlüssel (ohne Schlüssel wird nichts verschickt, nur protokolliert)
 *   MAIL_FROM       Absender, z. B. "Football Legacy <noreply@example.com>" (Domain muss bei Resend verifiziert sein)
 */
import { accountLang, translateHtml, translatorFor } from "./lang";

export interface MailMessage { to: string; subject: string; html: string; text: string }
export interface MailResult { sent: boolean; id?: string; error?: string }

type Transport = (m: MailMessage) => Promise<MailResult>;

const resend: Transport = async (m) => {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[mail] RESEND_API_KEY fehlt – „${m.subject}“ an ${m.to} wurde nicht verschickt.`);
    if (process.env.NODE_ENV !== "production") console.info(m.text);
    return { sent: false, error: "not_configured" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.MAIL_FROM ?? "Football Legacy <onboarding@resend.dev>", to: [m.to], subject: m.subject, html: m.html, text: m.text }),
  });
  if (!res.ok) {
    const error = `${res.status} ${(await res.text()).slice(0, 300)}`;
    console.error(`[mail] Resend-Fehler: ${error}`);
    return { sent: false, error };
  }
  const body = (await res.json()) as { id?: string };
  return { sent: true, id: body.id };
};

let transport: Transport = resend;

/** Für Tests: Versand abfangen. Ohne Argument wieder Resend. */
export function setMailTransport(t?: Transport) {
  transport = t ?? resend;
}

/** Ist der Versand eingerichtet (oder in Tests abgefangen)? */
export function mailConfigured(): boolean {
  return transport !== resend || !!process.env.RESEND_API_KEY;
}

/** Verschickt in der Sprache des Empfängers (Texte stehen deutsch im Code und werden bei Bedarf übersetzt). */
export async function sendMail(m: MailMessage): Promise<MailResult> {
  const lang = await accountLang({ email: m.to }).catch(() => "de" as const);
  if (lang === "de") return transport(m);
  const tr = await translatorFor(lang);
  return transport({
    to: m.to,
    subject: tr(m.subject),
    html: translateHtml(m.html.replace('<html>', `<html lang="${lang}">`), tr),
    text: m.text.split("\n").map((line) => tr(line)).join("\n"),
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Schlichte HTML-Mail im Stil des Spiels, mit Knopf und Klartext-Link. */
export function layout(title: string, paragraphs: string[], button?: { label: string; url: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${esc(p)}</p>`).join("");
  const cta = button
    ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#3d8bfd;color:#fff;text-decoration:none;padding:11px 20px;border-radius:4px;font-weight:700;display:inline-block">${esc(button.label)}</a></p>` +
      `<p style="margin:0 0 14px;font-size:12px;color:#6f7a8c">Falls der Knopf nicht funktioniert, kopiere diesen Link in den Browser:<br>${esc(button.url)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#0d1117;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#e6e9ef">
<div style="max-width:520px;margin:0 auto;background:#151a22;border:1px solid #262e3b;border-radius:6px;padding:28px">
<div style="font-weight:800;letter-spacing:.08em;font-size:13px;color:#3d8bfd;margin-bottom:14px">FOOTBALL LEGACY</div>
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>${body}${cta}
</div></body></html>`;
}
