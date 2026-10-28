import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Anmelden – Football Legacy" };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
