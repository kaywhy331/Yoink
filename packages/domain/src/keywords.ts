import { InputValidationError } from "./input-validation-error.js";

interface KeywordAtom {
  value: string;
  quoted: boolean;
}

interface KeywordQuery {
  clauses: KeywordAtom[][];
  exclusions: KeywordAtom[];
}

export function normalizeKeywordText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function atom(value: string, quoted: boolean): KeywordAtom {
  const normalized = normalizeKeywordText(value);
  if (!normalized) throw new InputValidationError("Keyword expressions cannot contain an empty term or phrase.");
  return { value: normalized, quoted };
}

export function parseKeywordQuery(input: unknown): KeywordQuery {
  const source = String(input ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 1_000);
  if (!source) return { clauses: [], exclusions: [] };
  const clauses: KeywordAtom[][] = [[]];
  const exclusions: KeywordAtom[] = [];
  let index = 0;

  const nextClause = (): void => {
    if ((clauses.at(-1)?.length ?? 0) > 0) clauses.push([]);
  };

  while (index < source.length) {
    while (/\s/.test(source[index] ?? "")) index += 1;
    if (index >= source.length) break;
    const current = source[index];
    if (current === "|" || current === ",") {
      nextClause();
      index += 1;
      continue;
    }
    if (current === "+") {
      index += 1;
      continue;
    }

    let excluded = false;
    if (source[index] === "-") {
      excluded = true;
      index += 1;
    }
    const quote = source[index] === "\"" || source[index] === "'" ? source[index] : "";
    let token = "";
    if (quote) {
      index += 1;
      const start = index;
      while (index < source.length && source[index] !== quote) index += 1;
      if (index >= source.length) throw new InputValidationError("Close every quoted keyword phrase with the same quote mark.");
      token = source.slice(start, index);
      index += 1;
    } else {
      const start = index;
      while (index < source.length && !/[\s+|,]/.test(source[index] ?? "")) index += 1;
      token = source.slice(start, index);
      if (/^or$/i.test(token)) {
        nextClause();
        continue;
      }
    }

    if (!token) throw new InputValidationError("Keyword operators must be followed by a term or phrase.");
    const parsed = atom(token, Boolean(quote));
    if (excluded) exclusions.push(parsed);
    else clauses.at(-1)?.push(parsed);
  }

  return { clauses: clauses.filter((clause) => clause.length > 0), exclusions };
}

function atomMatches(candidate: KeywordAtom, normalizedText: string): boolean {
  return ` ${normalizedText} `.includes(` ${candidate.value} `);
}

function queryMatches(query: KeywordQuery, normalizedText: string): boolean {
  if (query.exclusions.some((candidate) => atomMatches(candidate, normalizedText))) return false;
  if (!query.clauses.length) return true;
  return query.clauses.some((clause) => clause.every((candidate) => atomMatches(candidate, normalizedText)));
}

export function keywordRulesMatch(include: unknown, exclude: unknown, text: unknown): boolean {
  const normalizedText = normalizeKeywordText(text);
  const includeQuery = parseKeywordQuery(include);
  const excludeQuery = parseKeywordQuery(exclude);
  if (!queryMatches(includeQuery, normalizedText)) return false;
  if (excludeQuery.exclusions.some((candidate) => atomMatches(candidate, normalizedText))) return false;
  return !excludeQuery.clauses.some((clause) => clause.every((candidate) => atomMatches(candidate, normalizedText)));
}
