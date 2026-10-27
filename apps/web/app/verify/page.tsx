import { Suspense } from "react";
import { VerifyEmail } from "@/components/VerifyEmail";

export const metadata = { title: "E-Mail bestätigen – Football Legacy" };

export default function VerifyPage() {
  return <Suspense><VerifyEmail /></Suspense>;
}
