#!/usr/bin/env node
/**
 * Assertion mutation — "does this test pass for the RIGHT reason?".
 *
 * Code mutation asks whether a test notices when the ENGINE changes. It cannot see the other half:
 * a test whose assertion is decoration. `expect(count).toBe(0)` over a fixture that never reaches
 * the code, an assertion inside an `if` that never runs, or `expect(x).toBe(x)` all survive every
 * code mutant while testing nothing.
 *
 * Two passes:
 *
 *   STATIC (default, fast). Patterns that are wrong on their face:
 *     - tautology: the expected and actual texts are identical;
 *     - cannot-fail: an assertion over a literal, or a lower bound of 0;
 *     - `expect.assertions(0)`, which asserts that nothing was asserted;
 *     - an assertion inside a conditional, so it may never run;
 *     - `.only(`, which silently skips the rest of the suite in CI;
 *     - a test body with no `expect(` at all (reported; helper-based assertions are declared in the
 *       allowlist rather than guessed at).
 *
 *   EMPIRICAL (`--probe N`). The assertion itself is mutated: the expected literal is replaced by a
 *   different one and the test is re-run. If the test STILL PASSES, the assertion does not decide
 *   the outcome — it is DECORATIVE. A probe that cannot be applied is reported, never skipped
 *   silently, and the file is always restored.
 *
 * Usage:
 *   node scripts/assertions.mjs                    # static pass
 *   node scripts/assertions.mjs --probe 40         # static + 40 empirical probes spread over the suite
 *   node scripts/assertions.mjs --probe 20 --file test/qaTier3Hard.test.ts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'tools', 'open-sdd', 'test');
const workspace = path.join(root, 'tools', 'open-sdd');

/**
 * Assertions that are declared, not removed, because a human looked at them and they carry a reason.
 * `{ file, pattern, reason, owner }` — the pattern is matched against the finding's line text.
 */
const ALLOWLIST = [
  {
    file: 'qaTier3Hard.test.ts',
    pattern: 'expect([0, 1]).toContain(code)',
    reason:
      'El comando valida una spec hostil: el codigo 0 o 1 depende de si el hallazgo escala, y lo que la prueba fija es que NO se certifica, no cual de los dos sale.',
    owner: 'mantenimiento (bateria QA)',
  },
  {
    file: 'qaTier4Zombies.test.ts',
    pattern: 'expect(',
    reason:
      'La asercion condicional de la horda es deliberada y esta acotada: las CINCO propiedades del contrato (no revienta, ningun callejon sin salida, determinismo, solo lectura, nunca certifica) se afirman para los 100 ataques; el `if (attack.expect)` anade la comprobacion del defecto concreto solo a los ataques que lo declaran, porque exigirla a todos seria inventar una expectativa. Se declara con motivo en vez de silenciarse.',
    owner: 'mantenimiento (bateria QA)',
  },
  {
    file: 'coreCommandTemplates.test.ts',
    pattern: 'expect(',
    reason:
      'Contratos sobre un SUBCONJUNTO filtrado dentro de un bucle (`for (const host of HOST_COMMAND_TEMPLATES)`): «si el anfitrion esta verificado, declara directorio», «si no lo esta, cita la URL que fallo». La no-vacuidad del subconjunto la afirman los tests hermanos del mismo fichero («the conventions verified against the hosts docs are exactly those», «the unverified hosts are marked and name why»), que fijan cuantos hay de cada clase. Se declara en vez de duplicar esa precondicion en cada rama.',
    owner: 'mantenimiento (plantillas de comando)',
  },
  {
    file: 'hookPortability.test.ts',
    pattern: '0o111',
    reason:
      'Guarda de plataforma inevitable: en Windows no existe el bit de ejecucion, asi que la asercion del modo `0o111` no puede ejecutarse alli. El resto del test —que el hook instalado sea byte a byte el portable y no el fallback POSIX— si corre en todas las plataformas.',
    owner: 'mantenimiento (suelo de ejecucion)',
  },
];

const STATIC_RULES = [
  {
    id: 'tautology',
    severity: 'error',
    why: 'the expected and actual text are identical, so the assertion cannot fail',
    test: (line) => {
      const match = line.match(/expect\((.+?)\)\s*\.(toBe|toEqual|toStrictEqual)\((.+?)\)/);
      if (!match) return null;
      const actual = match[1].trim();
      const expected = match[3].trim();
      if (actual !== expected) return null;
      if (/^(true|false|null|undefined|\d+)$/.test(actual)) return null; // `cannot-fail` owns literals
      return `expect(${actual}).${match[2]}(${expected})`;
    },
  },
  {
    id: 'cannot-fail',
    severity: 'error',
    why: 'the assertion is over a literal, or a lower bound that a count satisfies by definition',
    test: (line) => {
      const literal = line.match(/expect\(\s*(true|false|null|undefined|-?\d+|'[^']*'|"[^"]*")\s*\)\s*\.(toBeTruthy|toBeDefined|toBeFalsy)\(\)/);
      if (literal) return `expect(${literal[1]}).${literal[2]}()`;
      // `>= 0` sólo es vacuo cuando el receptor es una longitud, un tamaño o un recuento: esas
      // magnitudes no pueden ser negativas, así que la aserción se cumple haga lo que haga el código.
      // Para un score o un porcentaje SÍ distingue (un bug puede producir -0.2), y acusarlo era un
      // falso positivo del arnés. `> 0` tampoco entra nunca: excluye la colección vacía.
      const vacuous = line.match(/expect\((.+?)\)\s*\.toBeGreaterThanOrEqual\(\s*0\s*\)/);
      if (vacuous && /\.(length|size|count)\b/.test(vacuous[1])) {
        return `expect(${vacuous[1].trim()}).toBeGreaterThanOrEqual(0)`;
      }
      const always = line.match(/expect\(\s*true\s*\)\s*\.toBe\(\s*true\s*\)/);
      if (always) return always[0];
      return null;
    },
  },
  {
    id: 'assertions-zero',
    severity: 'error',
    why: 'asserts that nothing was asserted',
    test: (line) => (line.includes('expect.assertions(0)') ? 'expect.assertions(0)' : null),
  },
  {
    id: 'focused',
    severity: 'error',
    why: '`.only` silently skips every other test in the file',
    test: (line) => {
      const match = line.match(/\b(it|describe|test)\.only\(/);
      return match ? match[0] : null;
    },
  },
];

/**
 * Blank out string literals, template literals, regex literals and comments, preserving every index.
 *
 * Brace and paren matching over raw source is wrong the moment a test contains `'{'` or a comment
 * with a brace in it: the count drifts and a range stretches over code it does not own. Regex
 * literals matter just as much: a pattern like `/['"]/` contains a quote, and without recognising the
 * regex the masker starts a "string" there and blanks real code after it.
 *
 * The `/` disambiguation is the classic heuristic: a regex follows an operator, an opening bracket or
 * a keyword, and a division follows an identifier or a literal.
 */
const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>']);
const KEYWORD_BEFORE_REGEX = /\b(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await|throw)\s*$/;

const maskLiterals = (text) => {
  // `split('')` y no `[...text]`: el spread itera PUNTOS DE CÓDIGO, así que en un fichero con emoji
  // el array queda más corto que `text.length` y todos los índices a partir del primer emoji se
  // desplazan — el informe acababa señalando la línea equivocada.
  const out = text.split('');
  const blank = (from, to) => {
    for (let index = from; index < to && index < out.length; index += 1) {
      if (out[index] !== '\n') out[index] = ' ';
    }
  };

  let index = 0;
  let lastSignificant = '';
  while (index < text.length) {
    const char = text[index];
    if (char === '/' && text[index + 1] === '/') {
      const from = index;
      while (index < text.length && text[index] !== '\n') index += 1;
      blank(from, index);
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      const from = index;
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      index = Math.min(text.length, index + 2);
      blank(from, index);
      continue;
    }
    if (
      char === '/' &&
      text[index + 1] !== '=' &&
      (REGEX_PRECEDERS.has(lastSignificant) || lastSignificant === '' || KEYWORD_BEFORE_REGEX.test(text.slice(0, index)))
    ) {
      const from = index;
      index += 1;
      let inClass = false;
      let closed = false;
      while (index < text.length) {
        const current = text[index];
        if (current === '\\') {
          index += 2;
          continue;
        }
        if (current === '[') inClass = true;
        else if (current === ']') inClass = false;
        else if (current === '\n') break; // un regex no cruza la línea: no era un regex
        else if (current === '/' && !inClass) {
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (closed) {
        blank(from, index);
        lastSignificant = ')';
        continue;
      }
      // No cerró: se deja como está y se sigue desde el mismo punto.
      index = from + 1;
      lastSignificant = '/';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      const from = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2;
          continue;
        }
        if (text[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      blank(from, index);
      lastSignificant = '"';
      continue;
    }
    if (!/\s/.test(char)) lastSignificant = char;
    index += 1;
  }
  return out.join('');
};

const readTests = (file) => {
  const source = readFileSync(path.join(testDir, file), 'utf8');
  const masked = maskLiterals(source);
  const blocks = [];
  const start = /\b(it|test)\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g;
  // Los `it(` se buscan en el ORIGINAL (su nombre es un literal, y enmascarado desaparece), pero se
  // descartan los que caen dentro de una zona enmascarada: `masked[index]` es un espacio cuando el
  // `it(` vive dentro de un literal o un comentario — una fixture que escribe un test falso en disco
  // no es un test. Buscar sobre el texto enmascarado directamente devolvía CERO bloques, y un
  // analizador sin bloques informa de un verde perfecto: el modo exacto de pasar por la razón
  // equivocada que esta herramienta existe para detectar.
  const matches = [...source.matchAll(start)].filter((match) => masked[match.index] === match[1][0]);
  for (const [position, match] of matches.entries()) {
    const name = match[3];
    // El final del bloque es el SIGUIENTE `it(`/`test(`, no una llave emparejada: un literal regex
    // como `/\{/` desbalancea el recuento de llaves y truncaba el cuerpo, lo que producía avisos de
    // «sin aserción» sobre tests que sí afirman.
    const open = masked.indexOf('{', match.index + match[0].length);
    if (open === -1) continue;
    const next = matches[position + 1]?.index ?? source.length;
    const end = next > open ? next - 1 : source.length - 1;
    blocks.push({ name, start: match.index, end, body: masked.slice(open, end + 1), raw: source.slice(open, end + 1) });
  }
  return { source, blocks };
};

const lineOf = (source, offset) => source.slice(0, offset).split('\n').length;

const isAllowed = (file, line) =>
  ALLOWLIST.some((entry) => entry.file === file && line.includes(entry.pattern));

const args = process.argv.slice(2);
const flagValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? '') : null;
};
const probeCount = flagValue('--probe') ? Number(flagValue('--probe')) : 0;
const onlyFile = flagValue('--file');

// ── STATIC ─────────────────────────────────────────────────────────────────────────────────────
const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.ts'))
  .filter((name) => !onlyFile || name === onlyFile)
  .sort();

const findings = [];
const warnings = [];
for (const file of files) {
  const { source, blocks } = readTests(file);
  const lines = source.split('\n');

  for (const [index, line] of lines.entries()) {
    if (isAllowed(file, line)) continue;
    for (const rule of STATIC_RULES) {
      const hit = rule.test(line);
      if (hit) findings.push({ file, line: index + 1, rule: rule.id, why: rule.why, hit });
    }
  }

  for (const block of blocks) {
    const blockLine = lineOf(source, block.start);
    const bodyLines = block.body.split('\n');
    if (!block.body.includes('expect(') && !block.body.includes('expect(')) {
      warnings.push({ file, line: blockLine, rule: 'no-assertion', why: 'the test body never calls expect()', hit: block.name });
      continue;
    }
    // Una aserción dentro de un `if` puede no ejecutarse nunca. Se calculan los RANGOS de los bloques
    // `if` por emparejamiento de llaves: la versión anterior llevaba un contador por líneas que se
    // contaminaba entre bloques y acusaba a aserciones que vivían dentro de un `for`.
    const ifRanges = [];
    const ifStart = /\b(?:if|else\s+if)\s*\(/g;
    let ifMatch;
    while ((ifMatch = ifStart.exec(block.body)) !== null) {
      const parenOpen = block.body.indexOf('(', ifMatch.index);
      let parenDepth = 0;
      let parenEnd = parenOpen;
      for (let index = parenOpen; index < block.body.length; index += 1) {
        if (block.body[index] === '(') parenDepth += 1;
        else if (block.body[index] === ')') {
          parenDepth -= 1;
          if (parenDepth === 0) {
            parenEnd = index;
            break;
          }
        }
      }
      const braceOpen = block.body.indexOf('{', parenEnd);
      if (braceOpen === -1 || block.body.slice(parenEnd, braceOpen).includes(';')) {
        const lineEnd = block.body.indexOf('\n', parenEnd);
        // La tupla lleva SIEMPRE los cuatro campos: sin `parenOpen`/`parenEnd` la condición se leía
        // como `undefined` y la guarda de narrowing no se reconocía jamás.
        ifRanges.push([parenEnd, lineEnd === -1 ? block.body.length : lineEnd, parenOpen, parenEnd]);
        continue;
      }
      let depth = 0;
      let braceEnd = braceOpen;
      for (let index = braceOpen; index < block.body.length; index += 1) {
        if (block.body[index] === '{') depth += 1;
        else if (block.body[index] === '}') {
          depth -= 1;
          if (depth === 0) {
            braceEnd = index;
            break;
          }
        }
      }
      ifRanges.push([braceOpen, braceEnd, parenOpen, parenEnd]);
    }

    const expectRe = /expect\(/g;
    let expectMatch;
    while ((expectMatch = expectRe.exec(block.body)) !== null) {
      const range = ifRanges.find(([from, to]) => expectMatch.index > from && expectMatch.index < to);
      if (!range) continue;
      const [from, to, parenOpen, parenEnd] = range;

      // IDIOMA CORRECTO 1 — partición: si el `else` también afirma, cada entrada toma una rama y
      // ninguna aserción puede quedar sin ejecutarse. Un `if` sin `else` sí es un hueco: la rama
      // puede no tomarse nunca y el test pasa sin comprobar nada.
      const afterElse = block.body.slice(to + 1).match(/^\s*else\s*\{/);
      if (afterElse) {
        const elseOpen = to + 1 + afterElse[0].length - 1;
        let depth = 0;
        let elseEnd = -1;
        for (let index = elseOpen; index < block.body.length; index += 1) {
          if (block.body[index] === '{') depth += 1;
          else if (block.body[index] === '}') {
            depth -= 1;
            if (depth === 0) {
              elseEnd = index;
              break;
            }
          }
        }
        // El `continue` va AQUÍ, en el bucle de aserciones: dentro del `for` de arriba habría
        // continuado el recorrido de llaves y la partición nunca se habría reconocido.
        if (elseEnd > elseOpen && block.body.slice(elseOpen, elseEnd).includes('expect(')) continue;
      }

      // IDIOMA CORRECTO 2 — guarda de narrowing: `expect(x.ok).toBe(false)` justo antes de
      // `if (!x.ok)`, para poder leer `x.reason`. La precondición YA está afirmada, así que la
      // aserción de dentro se ejecuta siempre que el test llegue hasta aquí.
      const condition = block.body.slice(parenOpen + 1, parenEnd).trim().replace(/^!\s*/, '');
      const before = block.body.slice(0, from);
      if (condition.length > 0 && before.includes(`expect(${condition})`)) continue;

      const offset = block.body.slice(0, expectMatch.index).split('\n').length - 1;
      const line = block.raw.split('\n')[offset] ?? '';
      if (isAllowed(file, line)) continue;
      findings.push({
        file,
        line: blockLine + offset,
        rule: 'conditional-assertion',
        why: `the assertion lives inside \`${condition || '?'}\` with no \`else\`, so it may never run`,
        hit: line.trim().slice(0, 90),
      });
    }
  }
}

console.log(`static pass — ${files.length} test file(s)\n`);
for (const finding of findings) {
  console.log(`  ${finding.rule.padEnd(22)} ${finding.file}:${finding.line}  ${finding.hit}`);
  console.log(`  ${''.padEnd(22)} ${finding.why}`);
}
if (findings.length === 0) console.log('  no vacuous or unfalsifiable assertion found');
if (warnings.length > 0) {
  console.log(`\n  warnings (${warnings.length}) — reported, not failing:`);
  for (const warning of warnings.slice(0, 20)) {
    console.log(`  ${warning.rule.padEnd(22)} ${warning.file}:${warning.line}  ${warning.hit}`);
  }
  if (warnings.length > 20) console.log(`  … and ${warnings.length - 20} more`);
}

// ── EMPIRICAL ──────────────────────────────────────────────────────────────────────────────────
const PROBES = [
  { find: /\.toBe\(\s*(\d+)\s*\)/, replace: (m) => `.toBe(${Number(m[1]) + 1})`, kind: 'number' },
  { find: /\.toBe\(\s*(true|false)\s*\)/, replace: (m) => `.toBe(${m[1] === 'true' ? 'false' : 'true'})`, kind: 'boolean' },
  { find: /\.toHaveLength\(\s*(\d+)\s*\)/, replace: (m) => `.toHaveLength(${Number(m[1]) + 1})`, kind: 'length' },
  { find: /\.toBeGreaterThan\(\s*(\d+)\s*\)/, replace: () => '.toBeGreaterThan(9007199254740991)', kind: 'lower-bound' },
  { find: /\.toBe\(\s*'([^'\n]{0,40})'\s*\)/, replace: () => ".toBe('__assertion_probe__')", kind: 'string' },
  { find: /\.toContain\(\s*'([^'\n]{0,40})'\s*\)/, replace: () => ".toContain('__assertion_probe__')", kind: 'contains' },
];

const probeResults = [];
if (probeCount > 0) {
  const candidates = [];
  for (const file of files) {
    const { blocks } = readTests(file);
    for (const block of blocks) {
      for (const probe of PROBES) {
        // Sobre el texto ORIGINAL, no sobre el enmascarado: las aserciones de cadena viven dentro de
        // literales, que el enmascarado borra. Y la mutación se aplica al original por la misma
        // razón: escribir el cuerpo enmascarado borraría todas las cadenas del fichero.
        const match = block.raw.match(probe.find);
        if (!match) continue;
        // Una aserción NEGADA no se toca: `.not.toContain('X')` mutado a `.not.toContain(probe)`
        // sigue cumpliéndose, y el arnés lo leería como «decorativa» cuando la aserción original sí
        // discriminaba. Se busca otra aserción en el mismo test.
        if (/\.not\s*$/.test(block.raw.slice(0, match.index))) continue;
        candidates.push({ file, name: block.name, probe, match, raw: block.raw });
        break; // one probe per test is enough to know whether its assertions decide the outcome
      }
    }
  }
  // Reparto determinista: se camina la lista con un paso primo para no probar solo los primeros.
  const step = Math.max(1, Math.floor(candidates.length / probeCount));
  const chosen = candidates.filter((_, index) => index % step === 0).slice(0, probeCount);

  console.log(`\nempirical pass — ${chosen.length} assertion probe(s)\n`);
  for (const candidate of chosen) {
    const abs = path.join(testDir, candidate.file);
    const original = readFileSync(abs, 'utf8');
    // El callback recibe el ARRAY de grupos, no la cadena: con la cadena, `m[1]` era su segundo
    // carácter y la mutación salía `.toBe(NaN)` — o no cambiaba nada y se reportaba NOT-APPLIED.
    const mutatedAssertion = candidate.match[0].replace(candidate.probe.find, (...args) => candidate.probe.replace(args));
    const mutated = original.replace(candidate.raw, candidate.raw.replace(candidate.match[0], mutatedAssertion));
    if (mutated === original) {
      probeResults.push({ ...candidate, verdict: 'NOT-APPLIED' });
      console.log(`  NOT-APPLIED  ${candidate.file} :: ${candidate.name}`);
      continue;
    }
    let output = '';
    let green;
    try {
      writeFileSync(abs, mutated, 'utf8');
      // El FICHERO entero, no `-t <nombre>`: el filtro por nombre puede seleccionar otro test (o
      // ninguno) y entonces la aserción mutada no se ejecuta nunca, lo que produce un falso
      // «decorativa». El baseline ya garantiza que el fichero pasa sin mutar.
      output = String(execFileSync('npx', ['vitest', 'run', candidate.file], { cwd: workspace, stdio: 'pipe' }));
      green = true;
    } catch (error) {
      output = String(error?.stdout ?? '');
      green = false;
    } finally {
      writeFileSync(abs, original, 'utf8');
    }

    // Si el filtro `-t` no selecciona el test, vitest no ejecuta NADA y un verde sería un falso
    // «decorativa»: se exige que la ejecución informe de al menos un test.
    if (/no test files? found|no tests? found/i.test(output) || !/Tests\s+\d+/.test(output)) {
      probeResults.push({ ...candidate, verdict: 'NOT-RUN' });
      console.log(`  NOT-RUN      ${candidate.file} :: ${candidate.name}`);
      continue;
    }
    probeResults.push({ ...candidate, verdict: green ? 'DECORATIVE' : 'load-bearing' });
    console.log(`  ${green ? 'DECORATIVE  ' : 'load-bearing'} ${candidate.file} :: ${candidate.name.slice(0, 60)}`);
  }
  const decorative = probeResults.filter((result) => result.verdict === 'DECORATIVE');
  const notApplied = probeResults.filter((result) => result.verdict === 'NOT-APPLIED');
  console.log(
    `\nprobes: ${probeResults.length - decorative.length - notApplied.length}/${probeResults.length} load-bearing · ${decorative.length} decorative · ${notApplied.length} not applied`,
  );
  for (const result of decorative) {
    console.log(`  DECORATIVE ${result.file} :: ${result.name}`);
    console.log(`             the assertion ${result.match[0]} was mutated and the test still passed`);
  }
}
console.log(
  `\nsummary: ${findings.length} static finding(s) · ${warnings.length} warning(s)` +
    (probeCount > 0 ? ` · ${probeResults.filter((r) => r.verdict === 'DECORATIVE').length} decorative assertion(s)` : ''),
);
process.exit(findings.length > 0 || probeResults.some((result) => result.verdict === 'DECORATIVE') ? 1 : 0);
