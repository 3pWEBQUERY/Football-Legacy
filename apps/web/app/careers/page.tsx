"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, useApi } from "@/lib/client/api";
import { seasonLabel } from "@/lib/client/format";
import { Crest, Empty, ErrorBox, Icon, Loading, useToast } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function CareersPage() {
  const { data, error, loading, reload } = useApi<{ careers: any[] }>("careers");
  const me = useApi<{ account: any }>("auth/me");
  const router = useRouter();
  const toast = useToast();

  async function remove(id: string, name: string) {
    if (!confirm(`Karriere „${name}“ wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    await api(`careers/${id}`, { method: "DELETE" });
    toast("Karriere gelöscht");
    reload();
  }

  async function logout() {
    await api("auth/logout", { body: {} });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="content" style={{ maxWidth: 920 }}>
      <div className="between">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">FL</div>
          <div>Football Legacy<small>{me.data?.account ? `Angemeldet als ${me.data.account.displayName}` : " "}</small></div>
        </div>
        <div className="row">
          <ThemeToggle compact />
          <Link className="btn btn-ghost btn-sm" href="/leaderboards"><Icon name="competition" size={16} /> Ranglisten</Link>
          <button className="btn btn-ghost btn-sm" onClick={logout}><Icon name="logout" size={16} /> Abmelden</button>
        </div>
      </div>
      <div className="page-head">
        <div>
          <h1>Deine Karrieren</h1>
          <p>Bis zu fünf Spielstände parallel, jeder mit eigener Welt.</p>
        </div>
        <Link className="btn btn-primary" href="/careers/new"><Icon name="plus" size={16} /> Neue Karriere</Link>
      </div>
      {me.data?.account?.login_streak > 1 && (
        <div className="card row" style={{ borderColor: "var(--warn)" }}>
          <span style={{ fontSize: 22 }}>🔥</span>
          <div><strong>{me.data?.account?.login_streak}-Tage-Serie!</strong> <span className="dim">Bei 3, 7 und 14 Tagen gibt es Manager-Punkte und Trainingsboni.</span></div>
        </div>
      )}
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      {data && data.careers.length === 0 && (
        <div className="card">
          <Empty>
            <div style={{ fontSize: 34 }}>⚽</div>
            <p>Noch keine Karriere. Wähle ein Land und einen Verein – und los geht’s.</p>
            <div style={{ marginTop: 14 }}><Link className="btn btn-primary" href="/careers/new">Erste Karriere starten</Link></div>
          </Empty>
        </div>
      )}
      <div className="stack">
        {data?.careers.map((c) => (
          <div key={c.id} className="card between">
            <Link href={`/c/${c.id}`} className="row" style={{ minWidth: 0, flex: 1 }}>
              {c.colors ? <Crest colors={c.colors} name={c.club_name ?? "?"} size={40} /> : <div style={{ width: 40 }} />}
              <div style={{ minWidth: 0 }}>
                <h3 className="truncate">{c.club_name ?? "Vereinslos"}</h3>
                <div className="dim small truncate">
                  {c.manager_name} · Level {c.level} · {c.league_name ?? "–"} · Saison {seasonLabel(c.season)}, Woche {c.week}/{c.season_weeks}
                </div>
              </div>
            </Link>
            <div className="row">
              <Link className="btn btn-primary btn-sm" href={`/c/${c.id}`}>Weiterspielen</Link>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(c.id, c.club_name ?? c.manager_name)} aria-label="Karriere löschen"><Icon name="trash" size={16} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
