import Link from "next/link";
import { Leaderboards } from "@/components/Leaderboards";

export const metadata = { title: "Ranglisten – Football Legacy" };

export default function PublicLeaderboards() {
  return (
    <div className="content">
      <div className="page-head">
        <div><h1>Ranglisten</h1><p>Die besten Manager von Football Legacy.</p></div>
        <Link className="btn" href="/careers">Zu deinen Karrieren</Link>
      </div>
      <Leaderboards />
    </div>
  );
}
