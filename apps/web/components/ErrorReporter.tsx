"use client";
import { useEffect } from "react";
import { reportClientError } from "@/lib/client/report";

/** Globale Fehler im Browser erfassen (einmal im Root-Layout). */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError(e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => {
      // Fehlermeldungen der API (z. B. „Bitte melde dich an“) sind erwartet
      if (e.reason && typeof e.reason === "object" && "status" in e.reason) return;
      reportClientError(e.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
