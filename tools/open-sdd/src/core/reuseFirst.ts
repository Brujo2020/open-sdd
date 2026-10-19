/**
 * Política de reutilización primero, como gate comprobable («SDD en Proyectos Brownfield» §4.1).
 *
 * Antes de generar cualquier clase o método nuevo, el agente debe buscar uno existente que ya sirva;
 * crear código nuevo solo está permitido cuando no existe nada reutilizable. La razón es concreta y
 * está en el documento: en brownfield la duplicación es «un riesgo enorme», porque dos copias de la
 * misma lógica divergen y la que se olvida es la que sigue en producción.
 *
 * ── Búsqueda de símbolos: por qué hay un escáner propio aquí ────────────────────────────────────
 * `gateRunner.buildSymbolIndex` construye un índice por NOMBRE DE MÓDULO (basename) y no guarda ni
 * líneas ni rutas: sirve para decidir si una referencia `modulo.simbolo` tiene definición, que es otra
 * pregunta. Para reutilización la pregunta es «¿dónde está ya esto?», y eso exige fichero y línea
 * (para poder citarlo en el informe y para que un humano lo abra). Por eso este módulo trae su propio
 * escáner, deliberadamente pequeño y conservador.
 *
 * ── Nada se declara limpio sin haber mirado ─────────────────────────────────────────────────────
 * Si no hay directorios de código fuente legibles, `complete: false` y un aviso: «no hay candidatos»
 * y «no se pudo buscar» son afirmaciones distintas y confundirlas convertiría el gate en decorado.
 *
 * Los textos visibles para el usuario son español, como el resto del CLI.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { scanProject } from './reverseEngineering.js';

export interface ReuseRequest { symbol: string; reason: string }

export interface ReuseCandidate {
  symbol: string;
  file: string;
  line: number;
  similarity: number;
  kind: 'same-name' | 'name-variant' | 'same-module';
}

export interface ReuseReport {
  requested: ReuseRequest[];
  candidates: ReuseCandidate[];
  /** Requested symbols that already have a reusable candidate: creating them would duplicate. */
  violations: string[];
  /** True when the search could actually run. */
  complete: boolean;
  detail: string;
}

export interface FindReuseCandidatesInput {
  cwd: string;
  requests: ReuseRequest[];
  sourceDirs?: string[];
  threshold?: number;
  maxCandidatesPerRequest?: number;
}

/** La política, citada del documento (§4.1). */
export const REUSE_FIRST_RULE =
  'Antes de generar cualquier clase o método nuevo, busca si ya existe uno reutilizable. Crear código nuevo solo está permitido cuando no existe nada reutilizable: la duplicación es un riesgo enorme en brownfield.';

export const DEFAULT_REUSE_THRESHOLD = 0.6;
export const DEFAULT_MAX_CANDIDATES_PER_REQUEST = 5;

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|rs)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);
const MAX_SOURCE_FILES = 4000;

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

// ---------------------------------------------------------------------------------------------
// Escáner de declaraciones (fichero + línea)
// ---------------------------------------------------------------------------------------------

const DECLARATION_PATTERNS: RegExp[] = [
  // TypeScript / JavaScript
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  // Python
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  // Go
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^\s*type\s+([A-Za-z_]\w*)\s+struct\b/,
  // Java / Kotlin / otros
  /^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+|open\s+)*(?:class|interface|enum|struct)\s+([A-Za-z_]\w*)/,
];

export interface DeclaredSymbol {
  symbol: string;
  file: string;
  line: number;
}

/** Símbolos declarados en un contenido, con su línea (1-based). */
export const scanDeclarations = (content: string): { symbol: string; line: number }[] => {
  const found: { symbol: string; line: number }[] = [];
  const seen = new Set<string>();
  content.split(/\r?\n/).forEach((line, index) => {
    for (const pattern of DECLARATION_PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      const key = `${match[1]}:${index + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ symbol: match[1], line: index + 1 });
    }
  });
  return found;
};

interface IndexWalk {
  symbols: DeclaredSymbol[];
  unreadable: { path: string; reason: string }[];
  truncated: boolean;
}

const buildDeclarationIndex = async (cwd: string, sourceDirs: string[]): Promise<IndexWalk> => {
  const symbols: DeclaredSymbol[] = [];
  const unreadable: { path: string; reason: string }[] = [];
  let truncated = false;
  let filesScanned = 0;

  const walk = async (rel: string, depth: number): Promise<void> => {
    if (truncated || depth > 8) return;
    let entries;
    try {
      entries = await readdir(path.join(cwd, rel), { withFileTypes: true });
    } catch (err) {
      unreadable.push({ path: rel, reason: (err as Error).message });
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(child, depth + 1);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXT.test(entry.name)) continue;
      if (filesScanned >= MAX_SOURCE_FILES) {
        truncated = true;
        return;
      }
      filesScanned += 1;
      let content: string;
      try {
        content = await readFile(path.join(cwd, child), 'utf8');
      } catch (err) {
        unreadable.push({ path: norm(child), reason: (err as Error).message });
        continue;
      }
      for (const declaration of scanDeclarations(content)) {
        symbols.push({ symbol: declaration.symbol, file: norm(child), line: declaration.line });
      }
    }
  };

  for (const dir of sourceDirs) await walk(norm(dir), 0);
  return { symbols, unreadable, truncated };
};

// ---------------------------------------------------------------------------------------------
// Similitud de nombres
// ---------------------------------------------------------------------------------------------

const normalizeName = (name: string): string => name.toLowerCase().replace(/[_-]/g, '');

const tokensOf = (name: string): string[] =>
  Array.from(
    new Set(
      name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .map((t) => t.toLowerCase())
        .filter((t) => t.length >= 2),
    ),
  );

const singular = (name: string): string => {
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`;
  if (name.endsWith('es')) return name.slice(0, -2);
  if (name.endsWith('s')) return name.slice(0, -1);
  return name;
};

const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
};

const tokenOverlap = (a: string, b: string): number => {
  const ta = tokensOf(a);
  const tb = tokensOf(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const shared = ta.filter((t) => tb.includes(t)).length;
  // Denominador = el mayor de los dos conjuntos: compartir un único token con un nombre corto no es
  // «solapamiento», o `getUser` haría candidato a cualquier declaración llamada `get`.
  return shared / Math.max(ta.length, tb.length);
};

export interface SimilarityVerdict {
  similarity: number;
  kind: ReuseCandidate['kind'];
}

/**
 * Similitud entre el símbolo pedido y uno declarado.
 *
 *   1.00 `same-name`     mismo nombre normalizado (mayúsculas, `_` y `-` no cuentan).
 *   0.80 `name-variant`  uno es prefijo/sufijo del otro, o difieren solo por plural/mayúsculas.
 *   0.60 `same-module`   distancia de Levenshtein ≤ 2 o solapamiento de tokens ≥ 0.6.
 *
 * El prefijo/sufijo exige además que el nombre corto cubra al menos la mitad del largo: sin esa
 * proporción, `total` sería «variante» de `totallyNewThing` y el gate convertiría la política en
 * ruido — el modo de fallo clásico de un control de duplicación.
 *
 * La tercera banda se etiqueta `same-module` tal y como la nombra el documento de origen. Nota
 * honesta: el documento la cualifica como «en el mismo directorio que los objetivos de la delta», y
 * `ReuseRequest` no lleva rutas de objetivo, así que la pertenencia al módulo no se puede evaluar con
 * esta firma. La etiqueta se conserva como nombre de la banda, no como una afirmación sobre la ruta.
 */
export const similarityOf = (requested: string, declared: string): SimilarityVerdict | null => {
  const a = normalizeName(requested);
  const b = normalizeName(declared);
  if (!a || !b) return null;

  if (a === b) return { similarity: 1, kind: 'same-name' };

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  const pluralVariant = singular(a) === singular(b);
  const prefixOrSuffix = shorter.length >= 4 && shorter.length / longer.length >= 0.5 && longer.includes(shorter);
  if (pluralVariant || prefixOrSuffix) return { similarity: 0.8, kind: 'name-variant' };

  if (shorter.length >= 4 && levenshtein(a, b) <= 2) return { similarity: 0.6, kind: 'same-module' };
  if (tokenOverlap(requested, declared) >= 0.6) return { similarity: 0.6, kind: 'same-module' };

  return null;
};

// ---------------------------------------------------------------------------------------------
// La búsqueda
// ---------------------------------------------------------------------------------------------

export const findReuseCandidates = async (input: FindReuseCandidatesInput): Promise<ReuseReport> => {
  const cwd = input.cwd;
  const threshold = input.threshold ?? DEFAULT_REUSE_THRESHOLD;
  const maxPerRequest = input.maxCandidatesPerRequest ?? DEFAULT_MAX_CANDIDATES_PER_REQUEST;
  const notes: string[] = [];
  let complete = true;

  const project = await scanProject(cwd);
  const sourceDirs = input.sourceDirs ?? project.sourceDirs;

  const index: IndexWalk =
    sourceDirs.length > 0
      ? await buildDeclarationIndex(cwd, sourceDirs)
      : { symbols: [], unreadable: [], truncated: false };

  if (sourceDirs.length === 0) {
    complete = false;
    notes.push(
      'No se detectó ningún directorio de código fuente legible: la búsqueda de reutilización NO se ejecutó, así que «no hay candidatos» no está demostrado y no se informa como si lo estuviera.',
    );
  }
  for (const bad of index.unreadable) {
    complete = false;
    notes.push(`No se pudo leer ${bad.path} (${bad.reason}): parte del código queda fuera de la búsqueda de reutilización.`);
  }
  if (index.truncated) {
    complete = false;
    notes.push('Se superó el límite de símbolos indexados: la búsqueda no fue exhaustiva.');
  }

  const candidates: ReuseCandidate[] = [];
  const violations: string[] = [];
  const unmatched: string[] = [];
  const belowThreshold: string[] = [];

  for (const request of input.requests) {
    const matches: ReuseCandidate[] = [];
    for (const declared of index.symbols) {
      const verdict = similarityOf(request.symbol, declared.symbol);
      if (!verdict || verdict.similarity < threshold) continue;
      matches.push({
        symbol: declared.symbol,
        file: declared.file,
        line: declared.line,
        similarity: verdict.similarity,
        kind: verdict.kind,
      });
    }

    if (matches.length > 0) {
      violations.push(request.symbol);
    } else {
      const loose = index.symbols.some((declared) => similarityOf(request.symbol, declared.symbol) !== null);
      if (loose) belowThreshold.push(request.symbol);
      else unmatched.push(request.symbol);
    }

    matches
      .sort((a, b) => b.similarity - a.similarity || a.symbol.localeCompare(b.symbol) || a.file.localeCompare(b.file))
      .slice(0, maxPerRequest)
      .forEach((candidate) => candidates.push(candidate));
  }

  // `ReuseCandidate` no lleva el símbolo pedido, así que el informe es un conjunto: se deduplica por
  // símbolo+fichero+línea conservando la similitud más alta.
  const deduped = new Map<string, ReuseCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.symbol}|${candidate.file}|${candidate.line}`;
    const existing = deduped.get(key);
    if (!existing || candidate.similarity > existing.similarity) deduped.set(key, candidate);
  }
  const finalCandidates = Array.from(deduped.values()).sort(
    (a, b) => b.similarity - a.similarity || a.symbol.localeCompare(b.symbol) || a.file.localeCompare(b.file),
  );

  if (violations.length > 0) {
    notes.push(
      `Violaciones de reutilización primero (${violations.length}): ${violations.join(', ')}. Estos símbolos ya tienen candidato reutilizable: crear una versión nueva duplica lógica existente.`,
    );
  }
  if (belowThreshold.length > 0) {
    notes.push(
      `Sin candidato por encima del umbral ${threshold} (revisar antes de crear): ${belowThreshold.join(', ')}.`,
    );
  }
  if (unmatched.length > 0) {
    notes.push(
      `El símbolo no existe en el proyecto, así que crearlo es legítimo: ${unmatched.join(', ')}. Esto no es una violación, es la excepción que la política permite.`,
    );
  }
  if (input.requests.length === 0) {
    notes.push('No se pidió ningún símbolo: no hay búsqueda de reutilización que hacer.');
  }
  if (!complete) {
    notes.push('Informe incompleto: no se declara «sin candidatos» sobre lo que no se pudo inspeccionar.');
  }

  const detail = [
    `Reutilización primero: ${input.requests.length} símbolo(s) pedido(s), ${finalCandidates.length} candidato(s) ≥ ${threshold}, ${violations.length} violación(es).`,
    ...notes,
  ].join(' ');

  return {
    requested: input.requests,
    candidates: finalCandidates,
    violations,
    complete,
    detail,
  };
};
