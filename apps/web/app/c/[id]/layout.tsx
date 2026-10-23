import { GameShell } from "@/components/GameShell";

export default async function CareerLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameShell id={id}>{children}</GameShell>;
}
