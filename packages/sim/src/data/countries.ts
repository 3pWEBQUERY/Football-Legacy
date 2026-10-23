/**
 * Länderprofile: reale Länder, fiktive Ligen. Die Ligapyramide (Anzahl Stufen,
 * Vereine pro Liga) ist an die echten Strukturen angelehnt, die Stärke (1–10)
 * bestimmt das Spielniveau.
 */
export interface CountryProfile {
  code: string;
  name: string;
  region: string; // Schlüssel in NAME_POOLS
  confed: "UEFA" | "CONMEBOL" | "CONCACAF" | "AFC" | "CAF" | "OFC";
  strength: number; // 1–10
  tiers: number[]; // Vereine pro Liga je Stufe
}

const RAW = `
ENG|England|en|UEFA|10|20,24,24,24
ESP|Spanien|es|UEFA|10|20,22
GER|Deutschland|de|UEFA|10|18,18,20
ITA|Italien|it|UEFA|9.5|20,20,20
FRA|Frankreich|fr|UEFA|9|18,18,18
POR|Portugal|pt|UEFA|8|18,18
NED|Niederlande|nl|UEFA|8|18,20
BEL|Belgien|nl|UEFA|7.5|16,16
TUR|Türkei|tr|UEFA|7|18,20
SCO|Schottland|en|UEFA|6|12,10,10,10
AUT|Österreich|de|UEFA|6.5|12,16
SUI|Schweiz|de|UEFA|6.5|12,10
GRE|Griechenland|gr|UEFA|6|14,16
RUS|Russland|slavicE|UEFA|6.5|16,18
UKR|Ukraine|slavicE|UEFA|6|16,16
CZE|Tschechien|slavicW|UEFA|6|16,16
DEN|Dänemark|nordic|UEFA|6|12,12
NOR|Norwegen|nordic|UEFA|5.5|16,16
SWE|Schweden|nordic|UEFA|5.5|16,16
POL|Polen|slavicW|UEFA|6|18,18
CRO|Kroatien|balkan|UEFA|6|10,12
SRB|Serbien|balkan|UEFA|5.5|16,16
ROU|Rumänien|ro|UEFA|5|16,16
HUN|Ungarn|hu|UEFA|5|12,16
BUL|Bulgarien|balkan|UEFA|4.5|16,16
SVK|Slowakei|slavicW|UEFA|4.5|12,16
SVN|Slowenien|balkan|UEFA|4|10,16
BIH|Bosnien und Herzegowina|balkan|UEFA|4|12,16
ISR|Israel|arab|UEFA|5|14,16
CYP|Zypern|gr|UEFA|4.5|14,16
FIN|Finnland|nordic|UEFA|4|12,10
ISL|Island|nordic|UEFA|3.5|12,12
IRL|Irland|en|UEFA|4|10,10
NIR|Nordirland|en|UEFA|3|12,12
WAL|Wales|en|UEFA|3|12,16
LUX|Luxemburg|fr|UEFA|2.5|16
MLT|Malta|en|UEFA|2|14
ALB|Albanien|balkan|UEFA|3.5|10,16
MKD|Nordmazedonien|balkan|UEFA|3|12
MNE|Montenegro|balkan|UEFA|3|10
KOS|Kosovo|balkan|UEFA|3|10
BLR|Belarus|slavicE|UEFA|3.5|16
MDA|Moldau|ro|UEFA|2.5|8
LTU|Litauen|slavicE|UEFA|2.5|10
LVA|Lettland|slavicE|UEFA|2.5|10
EST|Estland|slavicE|UEFA|2.5|10
GEO|Georgien|caucasus|UEFA|3.5|10
ARM|Armenien|caucasus|UEFA|3|10
AZE|Aserbaidschan|tr|UEFA|3.5|10
KAZ|Kasachstan|slavicE|UEFA|3.5|14
FRO|Färöer|nordic|UEFA|2|10
AND|Andorra|es|UEFA|1.5|10
SMR|San Marino|it|UEFA|1|15
GIB|Gibraltar|en|UEFA|1.5|10
BRA|Brasilien|br|CONMEBOL|9|20,20,20
ARG|Argentinien|latam|CONMEBOL|8.5|28,20
URU|Uruguay|latam|CONMEBOL|6|16,14
COL|Kolumbien|latam|CONMEBOL|6|20,16
CHI|Chile|latam|CONMEBOL|5.5|16,16
ECU|Ecuador|latam|CONMEBOL|5.5|16,10
PAR|Paraguay|latam|CONMEBOL|5|12,16
PER|Peru|latam|CONMEBOL|5|18,14
BOL|Bolivien|latam|CONMEBOL|4|16
VEN|Venezuela|latam|CONMEBOL|4|14
MEX|Mexiko|latam|CONCACAF|7|18,16
USA|USA|en|CONCACAF|6.5|30,24
CAN|Kanada|en|CONCACAF|4.5|8
CRC|Costa Rica|latam|CONCACAF|4.5|12
HON|Honduras|latam|CONCACAF|3.5|10
PAN|Panama|latam|CONCACAF|3.5|12
GUA|Guatemala|latam|CONCACAF|3|12
SLV|El Salvador|latam|CONCACAF|3|12
JAM|Jamaika|en|CONCACAF|3|14
TRI|Trinidad und Tobago|en|CONCACAF|2.5|10
HAI|Haiti|fr|CONCACAF|2|16
CUB|Kuba|latam|CONCACAF|2|12
DOM|Dominikanische Republik|latam|CONCACAF|2|12
NCA|Nicaragua|latam|CONCACAF|2|10
JPN|Japan|jp|AFC|6.5|20,20,20
KOR|Südkorea|kr|AFC|6|12,13
KSA|Saudi-Arabien|arab|AFC|6.5|18,18
CHN|China|cn|AFC|5|16,16
IRN|Iran|persian|AFC|5|16,18
QAT|Katar|arab|AFC|5|12
UAE|Vereinigte Arabische Emirate|arab|AFC|5|14
AUS|Australien|en|AFC|5|12
IND|Indien|in|AFC|3|14
THA|Thailand|sea|AFC|4|16
IDN|Indonesien|sea|AFC|3.5|18
VIE|Vietnam|sea|AFC|3.5|14
MAS|Malaysia|sea|AFC|3|14
UZB|Usbekistan|slavicE|AFC|4|14
IRQ|Irak|arab|AFC|3.5|20
JOR|Jordanien|arab|AFC|3|12
SYR|Syrien|arab|AFC|2.5|14
LBN|Libanon|arab|AFC|2.5|12
OMA|Oman|arab|AFC|3|14
BHR|Bahrain|arab|AFC|2.5|10
KUW|Kuwait|arab|AFC|2.5|10
PHI|Philippinen|sea|AFC|2|10
SIN|Singapur|sea|AFC|2.5|9
HKG|Hongkong|cn|AFC|2|10
TJK|Tadschikistan|persian|AFC|2.5|10
KGZ|Kirgisistan|slavicE|AFC|2|10
TKM|Turkmenistan|tr|AFC|2|10
PAK|Pakistan|in|AFC|1.5|12
BAN|Bangladesch|in|AFC|1.5|10
NEP|Nepal|in|AFC|1.5|14
MYA|Myanmar|sea|AFC|2|12
CAM|Kambodscha|sea|AFC|1.5|11
EGY|Ägypten|arab|CAF|5.5|18
MAR|Marokko|arab|CAF|5.5|16
TUN|Tunesien|arab|CAF|5|16
ALG|Algerien|arab|CAF|5|16
RSA|Südafrika|eaf|CAF|5|16
NGA|Nigeria|waf|CAF|4.5|20
GHA|Ghana|waf|CAF|4|18
SEN|Senegal|waf|CAF|4.5|14
CIV|Elfenbeinküste|waf|CAF|4.5|14
CMR|Kamerun|waf|CAF|4|18
MLI|Mali|waf|CAF|3.5|16
BFA|Burkina Faso|waf|CAF|3|16
GUI|Guinea|waf|CAF|3|14
COD|DR Kongo|waf|CAF|4|16
CGO|Kongo|waf|CAF|2.5|14
GAB|Gabun|waf|CAF|2.5|12
ANG|Angola|eaf|CAF|3|16
ZAM|Sambia|eaf|CAF|3.5|18
ZIM|Simbabwe|eaf|CAF|3|18
KEN|Kenia|eaf|CAF|3|18
TAN|Tansania|eaf|CAF|3.5|16
UGA|Uganda|eaf|CAF|3|16
ETH|Äthiopien|eaf|CAF|2.5|16
SUD|Sudan|arab|CAF|2.5|16
LBY|Libyen|arab|CAF|3|16
BEN|Benin|waf|CAF|2.5|14
TOG|Togo|waf|CAF|2|14
NIG|Niger|waf|CAF|2|14
CPV|Kap Verde|pt|CAF|3|12
MOZ|Mosambik|eaf|CAF|2.5|14
BOT|Botswana|eaf|CAF|2|16
NAM|Namibia|eaf|CAF|2|16
MAD|Madagaskar|fr|CAF|2|14
RWA|Ruanda|eaf|CAF|2|16
MWI|Malawi|eaf|CAF|2|16
GAM|Gambia|waf|CAF|2|12
SLE|Sierra Leone|waf|CAF|1.5|12
LBR|Liberia|waf|CAF|1.5|12
MTN|Mauretanien|arab|CAF|2|14
NZL|Neuseeland|en|OFC|3|10
FIJ|Fidschi|en|OFC|1.5|10
PNG|Papua-Neuguinea|en|OFC|1.5|10
SOL|Salomonen|en|OFC|1.5|10
TAH|Tahiti|fr|OFC|1.5|10
NCL|Neukaledonien|fr|OFC|1.5|10
`;

export const COUNTRIES: CountryProfile[] = RAW.trim()
  .split("\n")
  .map((line) => {
    const [code, name, region, confed, strength, tiers] = line.split("|");
    return {
      code,
      name,
      region,
      confed: confed as CountryProfile["confed"],
      strength: Number(strength),
      tiers: tiers.split(",").map(Number),
    };
  });

export const COUNTRY_BY_CODE: Record<string, CountryProfile> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c]),
);

/** ISO-3166-alpha-2 für Flaggen-Emojis (England & Co. über Tag-Sequenzen). */
const ALPHA2: Record<string, string> = {
  ESP: "ES", GER: "DE", ITA: "IT", FRA: "FR", POR: "PT", NED: "NL", BEL: "BE", TUR: "TR", AUT: "AT",
  SUI: "CH", GRE: "GR", RUS: "RU", UKR: "UA", CZE: "CZ", DEN: "DK", NOR: "NO", SWE: "SE", POL: "PL",
  CRO: "HR", SRB: "RS", ROU: "RO", HUN: "HU", BUL: "BG", SVK: "SK", SVN: "SI", BIH: "BA", ISR: "IL",
  CYP: "CY", FIN: "FI", ISL: "IS", IRL: "IE", LUX: "LU", MLT: "MT", ALB: "AL", MKD: "MK", MNE: "ME",
  KOS: "XK", BLR: "BY", MDA: "MD", LTU: "LT", LVA: "LV", EST: "EE", GEO: "GE", ARM: "AM", AZE: "AZ",
  KAZ: "KZ", FRO: "FO", AND: "AD", SMR: "SM", GIB: "GI", BRA: "BR", ARG: "AR", URU: "UY", COL: "CO",
  CHI: "CL", ECU: "EC", PAR: "PY", PER: "PE", BOL: "BO", VEN: "VE", MEX: "MX", USA: "US", CAN: "CA",
  CRC: "CR", HON: "HN", PAN: "PA", GUA: "GT", SLV: "SV", JAM: "JM", TRI: "TT", HAI: "HT", CUB: "CU",
  DOM: "DO", NCA: "NI", JPN: "JP", KOR: "KR", KSA: "SA", CHN: "CN", IRN: "IR", QAT: "QA", UAE: "AE",
  AUS: "AU", IND: "IN", THA: "TH", IDN: "ID", VIE: "VN", MAS: "MY", UZB: "UZ", IRQ: "IQ", JOR: "JO",
  SYR: "SY", LBN: "LB", OMA: "OM", BHR: "BH", KUW: "KW", PHI: "PH", SIN: "SG", HKG: "HK", TJK: "TJ",
  KGZ: "KG", TKM: "TM", PAK: "PK", BAN: "BD", NEP: "NP", MYA: "MM", CAM: "KH", EGY: "EG", MAR: "MA",
  TUN: "TN", ALG: "DZ", RSA: "ZA", NGA: "NG", GHA: "GH", SEN: "SN", CIV: "CI", CMR: "CM", MLI: "ML",
  BFA: "BF", GUI: "GN", COD: "CD", CGO: "CG", GAB: "GA", ANG: "AO", ZAM: "ZM", ZIM: "ZW", KEN: "KE",
  TAN: "TZ", UGA: "UG", ETH: "ET", SUD: "SD", LBY: "LY", BEN: "BJ", TOG: "TG", NIG: "NE", CPV: "CV",
  MOZ: "MZ", BOT: "BW", NAM: "NA", MAD: "MG", RWA: "RW", MWI: "MW", GAM: "GM", SLE: "SL", LBR: "LR",
  MTN: "MR", NZL: "NZ", FIJ: "FJ", PNG: "PG", SOL: "SB", TAH: "PF", NCL: "NC",
};

const SUBDIVISION: Record<string, string> = { ENG: "gbeng", SCO: "gbsct", WAL: "gbwls" };

export function flagEmoji(code: string): string {
  const sub = SUBDIVISION[code];
  if (sub) {
    return (
      String.fromCodePoint(0x1f3f4) +
      [...sub].map((ch) => String.fromCodePoint(0xe0000 + ch.charCodeAt(0))).join("") +
      String.fromCodePoint(0xe007f)
    );
  }
  const a2 = code === "NIR" ? "GB" : ALPHA2[code];
  if (!a2) return "🏳️";
  return [...a2].map((ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65)).join("");
}
