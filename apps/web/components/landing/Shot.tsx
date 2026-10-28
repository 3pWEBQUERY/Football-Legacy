import type { Lang } from "@fl/i18n";

/** Screenshot aus public/landing in der Sprache des Besuchers (die Startseite wird auf dem Server gerendert). */
export function Shot({ name, alt, lang, priority = false, className }: { name: string; alt: string; lang: Lang; priority?: boolean; className?: string }) {
  const [w, h] = name === "mobile" ? [780, 1688] : [1800, 1125];
  return (
    <img className={className} src={`/landing/${name}.${lang}.webp`} alt={alt} width={w} height={h}
      loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : "auto"} />
  );
}
