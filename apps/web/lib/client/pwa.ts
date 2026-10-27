/** Installierbare App (Service Worker, Installationsdialog) und Push-Abos im Browser. */
import { api } from "./api";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function onPwaChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => { deferred = null; emit(); });
  navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("Service Worker", e));
}

export const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
export const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
export const canInstall = () => !!deferred;

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  emit();
  return outcome === "accepted";
}

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(topics: string[]) {
  if (!pushSupported()) throw new Error("Dieser Browser unterstützt keine Push-Mitteilungen.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Mitteilungen wurden im Browser nicht erlaubt.");
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>("push/key");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  return api<any>("push/subscribe", { method: "POST", body: { ...sub.toJSON(), topics } });
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api("push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => null);
  await sub.unsubscribe();
}
