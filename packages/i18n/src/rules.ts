/**
 * Feste Regeln für Formate, die nicht aus dem Quelltext stammen: Datumsangaben
 * aus fmtDate ("Mo 06.07.2026", "Montag, 6. Juli 2026") und Geldbeträge.
 */
const WD: Record<string, string> = { Mo: "Mon", Di: "Tue", Mi: "Wed", Do: "Thu", Fr: "Fri", Sa: "Sat", So: "Sun" };
const WD_LONG: Record<string, string> = {
  Montag: "Monday", Dienstag: "Tuesday", Mittwoch: "Wednesday", Donnerstag: "Thursday", Freitag: "Friday", Samstag: "Saturday", Sonntag: "Sunday",
};
const MONTHS: Record<string, string> = {
  Januar: "January", Februar: "February", März: "March", April: "April", Mai: "May", Juni: "June",
  Juli: "July", August: "August", September: "September", Oktober: "October", November: "November", Dezember: "December",
};
const MON = Object.keys(MONTHS).join("|");

export function builtinRule(s: string): string | null {
  let m = /^(Mo|Di|Mi|Do|Fr|Sa|So)\.?,? (\d{1,2})\.(\d{1,2})\.(\d{4})?$/.exec(s);
  if (m) return `${WD[m[1]]} ${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}${m[4] ? `/${m[4]}` : ""}`;
  m = new RegExp(`^(${Object.keys(WD_LONG).join("|")}), (\\d{1,2})\\. (${MON}) (\\d{4})$`).exec(s);
  if (m) return `${WD_LONG[m[1]]}, ${m[2]} ${MONTHS[m[3]]} ${m[4]}`;
  m = new RegExp(`^(\\d{1,2})\\. (${MON})(?: (\\d{4}))?$`).exec(s);
  if (m) return `${m[1]} ${MONTHS[m[2]]}${m[3] ? ` ${m[3]}` : ""}`;
  m = new RegExp(`^(${MON})(?: (\\d{4}))?$`).exec(s);
  if (m) return `${MONTHS[m[1]]}${m[2] ? ` ${m[2]}` : ""}`;
  if (WD_LONG[s]) return WD_LONG[s];
  // Geld: "54.6 Mio. €" → "€54.6m", "-1.2 Mio. €"
  m = /^(-?)([\d.,'’]+) Mio\. €$/.exec(s);
  if (m) return `${m[1]}€${m[2]}m`;
  m = /^(-?)([\d.,'’]+)k €$/.exec(s);
  if (m) return `${m[1]}€${m[2]}k`;
  m = /^(-?)([\d.,'’]+) €$/.exec(s);
  if (m) return `${m[1]}€${m[2]}`;
  return null;
}
