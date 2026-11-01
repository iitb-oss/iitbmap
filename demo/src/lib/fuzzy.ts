import { normalizeName as normalize } from "./building-url";

/** Optimal-string-alignment distance: insert/delete/substitute/swap-adjacent each cost 1. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const allowedTypos = (word: string) => (word.length <= 3 ? 0 : word.length <= 6 ? 1 : 2);

/** Typed word vs name word, compared as a prefix so partial typing matches. */
function wordCost(typed: string, word: string): number {
  if (word.startsWith(typed)) return 0;
  // Compare against same-length (+/-1) prefixes so "victo" still matches "viktor".
  return Math.min(
    ...[typed.length - 1, typed.length, typed.length + 1].map((n) => editDistance(typed, word.slice(0, Math.max(n, 1)))),
  );
}

// letters and digits as separate words on both sides, so "hostel15" finds "Hostel 15A"
const splitDigits = (s: string) => s.replace(/(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/g, " ");

const NO_ALIASES: Record<string, string[]> = {};
const STOPWORDS = new Set(["of", "and", "for", "the", "in", "no"]);

// "Lecture Hall Complex" -> "lecturehallcomplex"
const squash = (s: string) => normalize(s).replace(/ /g, "");

interface Entry {
  name: string;
  full: string; // normalized name, letters and digits apart
  words: string[]; // matched with typo tolerance
  codes: string[]; // initialisms and aliases; exact prefix only, typos on short codes match everything
  aliases: string[]; // hand-written, so an exact match outranks an initialism
  nameWords: string[]; // name only, to spot alias-only matches
  nameCodes: string[];
  aliasList: { text: string; words: string[]; code: string }[];
}

function toEntry(name: string, aliases: string[]): Entry {
  const full = normalize(name);
  const words = full.split(" ");
  const parts = splitDigits(full).split(" ");
  const initials = words.filter((w) => !STOPWORDS.has(w)).map((w) => (/^\d/.test(w) ? w : w[0])).join(""); // "Hostel 12" -> "h12"
  // every suffix, so "ese" matches as well as "dese"
  const codes = [...initials].map((_, i) => initials.slice(i)).filter((c) => c.length >= 2);
  const aliasList = aliases.map((text) => ({ text, words: splitDigits(normalize(text)).split(" "), code: squash(text) }));
  const aliasCodes = aliasList.map((a) => a.code);
  // campus shorthand: "H5" is Hostel 5 and its wings
  const hostel = full.match(/^(?:hostel (?:no )?|h )(\d+) ?[a-d]?(?: wing(?: [a-d])?)?$/);
  if (hostel) codes.push(`h${hostel[1]}`);
  // "H 15 Wing B" names a hostel too
  if (hostel && !full.startsWith("hostel")) parts.push("hostel");
  return {
    name,
    full: splitDigits(full),
    words: [...parts, ...aliasList.flatMap((a) => a.words)],
    codes: [...codes, ...aliasCodes],
    aliases: hostel ? [...aliasCodes, `h${hostel[1]}`] : aliasCodes,
    nameWords: parts,
    nameCodes: codes,
    aliasList,
  };
}

/** Summed typo cost; Infinity when any typed word misses. */
function matchCost(typed: string[], words: string[], codes: string[]): number {
  let cost = 0;
  for (const t of typed) {
    const best = codes.some((c) => c.startsWith(t)) ? 0 : Math.min(...words.map((w) => wordCost(t, w)));
    if (best > allowedTypos(t)) return Infinity;
    cost += best;
  }
  return cost;
}

const entryCache = new WeakMap<string[], { aliases: Record<string, string[]>; entries: Entry[] }>();

export interface NameMatch {
  name: string;
  alias?: string; // set on alias-only matches
}

/** Names matching query, best first; each typed word must hit a name word (with typos), an initialism or an alias. */
export function searchMatches(query: string, names: string[], aliases: Record<string, string[]> = NO_ALIASES): NameMatch[] {
  const q = normalize(query);
  if (!q) return [];
  let cached = entryCache.get(names);
  if (cached?.aliases !== aliases) {
    cached = { aliases, entries: names.map((n) => toEntry(n, aliases[n] ?? [])) };
    entryCache.set(names, cached);
  }
  const { entries } = cached;
  const code = squash(query);
  const spaced = splitDigits(q);
  const typed = spaced.split(" ");
  const scored: { e: Entry; tier: number; cost: number }[] = [];
  for (const e of entries) {
    const cost = matchCost(typed, e.words, e.codes);
    if (cost === Infinity) continue;
    const tier = e.aliases.includes(code) ? 0 : e.codes.includes(code) ? 1 : e.full.includes(spaced) ? 2 : 3;
    scored.push({ e, tier, cost });
  }
  return scored
    .sort((a, b) => a.tier - b.tier || a.cost - b.cost || a.e.name.length - b.e.name.length)
    .slice(0, 8)
    .map(({ e }) => ({ name: e.name, alias: aliasFor(e, typed, code) }));
}

/** Alias-only matches; an exact alias wins over a fuzzy one. */
function aliasFor(e: Entry, typed: string[], code: string): string | undefined {
  if (!e.aliasList.length || matchCost(typed, e.nameWords, e.nameCodes) !== Infinity) return undefined;
  return (e.aliasList.find((a) => a.code === code) ?? e.aliasList.find((a) => matchCost(typed, a.words, [a.code]) !== Infinity))?.text;
}

export const searchNames = (query: string, names: string[], aliases?: Record<string, string[]>): string[] =>
  searchMatches(query, names, aliases).map((m) => m.name);
