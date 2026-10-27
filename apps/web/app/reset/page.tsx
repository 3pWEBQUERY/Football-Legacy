import { Suspense } from "react";
import { ResetForm } from "@/components/PasswordReset";

export const metadata = { title: "Neues Passwort – Football Legacy" };

export default function ResetPage() {
  return <Suspense><ResetForm /></Suspense>;
}
