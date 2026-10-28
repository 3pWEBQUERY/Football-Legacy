import { Fragment, type ReactNode } from "react";

/**
 * Text einer Meldung: Absätze durch Leerzeilen, "## " Zwischenüberschrift,
 * "- " Aufzählung, "> " Zitat, **fett** und [Linktext](https://…).
 * Kein HTML: alles wird als Text gesetzt, Links nur auf http(s) oder eigene Pfade.
 */
export function NewsBody({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="nw-body">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (b.startsWith("### ")) return <h3 key={i}>{inline(b.slice(4))}</h3>;
        if (b.startsWith("## ")) return <h2 key={i}>{inline(b.slice(3))}</h2>;
        if (lines.every((l) => /^[-*] /.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}</ul>;
        if (lines.every((l) => l.startsWith(">"))) return <blockquote key={i}>{inline(lines.map((l) => l.replace(/^>\s?/, "")).join(" "))}</blockquote>;
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
      })}
    </div>
  );
}

const safeHref = (h: string) => /^https?:\/\//i.test(h) || /^\/(?![/\\])/.test(h);

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index}>{m[1]}</strong>);
    else if (safeHref(m[3])) {
      const external = /^https?:/i.test(m[3]);
      out.push(<a key={m.index} href={m[3]} {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}>{m[2]}</a>);
    } else out.push(m[2]);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
