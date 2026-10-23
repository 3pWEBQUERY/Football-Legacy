"use client";
import { MobileSubnav } from "@/components/GameShell";
import { Leaderboards } from "@/components/Leaderboards";

export default function LeaderboardsPage() {
  return (
    <>
      <MobileSubnav section="career" />
      <div className="page-head"><div><h1>Ranglisten</h1><p>Alle Manager von Football Legacy im Vergleich.</p></div></div>
      <Leaderboards />
    </>
  );
}
