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
    if (!confirm(`Spielstand „${name}“ wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    await api(`careers/${id}`, { method: "DELETE" });
    toast("Spielstand gelöscht");
    reload();
  }

  async function logout() {
    await api("auth/logout", { body: {} });
    router.push("/");
    router.refresh();
  }

  const streak = me.data?.account?.login_streak ?? 0;

  return (
    <div className="landing">
      <header className="landing-top">
        <div className="row" style={{ gap: 10 }}>
          <div className="brand-mark">FL</div>
          <div className="brand-name">Football Legacy<small>{me.data?.account?.displayName ?? "Manager"}</small></div>
        </div>
        <div className="row">
          <ThemeToggle compact />
          <Link className="btn btn-ghost btn-sm" href="/leaderboards"><Icon name="trophy" size={15} /> Ranglisten</Link>
          <button className="btn btn-ghost btn-sm" onClick={logout}><Icon name="logout" size={15} /> Abmelden</button>
        </div>
      </header>
      <div className="content" style={{ maxWidth: 1000 }}>
        <div className="page-head">
          <div>
            <h1>Spielstände</h1>
            <p>Bis zu fünf Karrieren parallel, jede mit eigener Welt.{streak > 1 ? ` Login-Serie: ${streak} Tage.` : ""}</p>
          </div>
          <Link className="btn btn-primary btn-lg" href="/careers/new"><Icon name="plus" size={16} /> Neue Karriere</Link>
        </div>
        {loading && <Loading />}
        {error && <ErrorBox message={error} />}
        {data && (
          <section className="card card-flush">
            <div className="card-head"><h3>Gespeicherte Karrieren</h3><span className="faint small">{data.careers.length} / 5</span></div>
            {data.careers.length === 0 ? (
              <Empty>
                <p>Noch keine Karriere. Wähle ein Land und einen Verein.</p>
                <div style={{ marginTop: 12 }}><Link className="btn btn-primary" href="/careers/new">Erste Karriere starten</Link></div>
              </Empty>
            ) : (
              <table className="table">
                <thead><tr><th>Verein</th><th>Manager</th><th>Liga</th><th className="c">Saison</th><th className="c">Level</th><th /></tr></thead>
                <tbody>
                  {data.careers.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => router.push(`/c/${c.id}`)}>
                      <td>
                        <span className="row" style={{ gap: 10 }}>
                          {c.colors ? <Crest colors={c.colors} name={c.club_name ?? "?"} size={26} /> : <span style={{ width: 26 }} />}
                          <span className="cond up" style={{ fontSize: 16, fontWeight: 700 }}>{c.club_name ?? "Vereinslos"}</span>
                        </span>
                      </td>
                      <td>{c.manager_name}</td>
                      <td className="dim">{c.league_name ?? "–"}</td>
                      <td className="c">{seasonLabel(c.season)} · W{c.week}</td>
                      <td className="c cond" style={{ fontWeight: 700 }}>{c.level}</td>
                      <td className="r nowrap" onClick={(e) => e.stopPropagation()}>
                        <Link className="btn btn-primary btn-sm" href={`/c/${c.id}`}>Laden</Link>{" "}
                        <button className="btn btn-ghost btn-sm" onClick={() => remove(c.id, c.club_name ?? c.manager_name)} aria-label="Spielstand löschen"><Icon name="trash" size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
