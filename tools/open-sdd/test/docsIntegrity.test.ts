import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** GitHub-style heading slug: lowercase, punctuation dropped, spaces to hyphens. */
const slug = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const markdownFiles = (dir: string, depth = 0): string[] => {
  const out: string[] = [];
  if (depth > 7) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full, depth + 1));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
};

describe('documentation — internal anchors resolve', () => {
  // A rename sweep (kiro-* -> sdd-*, /kiro: -> /) silently broke 39 table-of-contents anchors: the
  // visible link text changed and the slug did not, so every "see below" pointer died while the
  // prose still looked right. Link rot is exactly the class of silent failure the gates exist for.
  it('every in-page link points at a heading that exists', () => {
    const docsDir = path.join(repoRoot, 'docs');
    let broken = 0;
    const failures: string[] = [];

    for (const file of markdownFiles(docsDir)) {
      const content = readFileSync(file, 'utf8');
      const headings = new Set(
        [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])),
      );
      const links = [...new Set([...content.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]))];
      for (const link of links) {
        if (!headings.has(link)) {
          broken += 1;
          failures.push(`${path.relative(repoRoot, file)} -> #${link}`);
        }
      }
    }

    expect(failures, `broken anchors:\n${failures.join('\n')}`).toEqual([]);
    expect(broken).toBe(0);
  });
});

describe('documentation — every referenced command and skill exists', () => {
  it('inline code spans that start with a slash name a real skill or command', () => {
    const skillsDir = path.join(
      repoRoot,
      'tools',
      'open-sdd',
      'templates',
      'agents',
      'claude-code-skills',
      'skills',
    );
    const commandsDir = path.join(
      repoRoot,
      'tools',
      'open-sdd',
      'templates',
      'agents',
      'claude-code',
      'commands',
    );
    const realSkills = new Set(readdirSync(skillsDir));
    // Cursor namespaces its commands as /sdd/<name>; Claude Code exposes /<name>.
    const realCommands = new Set(readdirSync(commandsDir).map((f) => f.replace(/\.md$/, '')));
    const allNames = [...realSkills, ...realCommands];

    const files = [
      ...markdownFiles(path.join(repoRoot, 'docs', 'guides')),
      ...markdownFiles(path.join(repoRoot, 'tools', 'open-sdd', 'templates')),
    ];

    const unknown = new Set<string>();
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      // Only inline code spans that BEGIN with a slash are command references; paths such as
      // `references/spec-seed-template.md` and prose are not.
      for (const m of content.matchAll(/`(\/[^`\n]+)`/g)) {
        const token = m[1]
          .slice(1)
          .split(/[\s<{(\[*]/)[0]
          .replace(/[.,;:!?]+$/, '');
        if (!token) continue;

        // Only command namespaces are audited: a code span such as `/api/v1/resource` or
        // `/users/123` is an example route, not a skill. `kiro` is included so a regression to the
        // retired naming is caught rather than silently skipped.
        const namespace = token.split('/')[0];
        if (!['sdd', 'spec', 'validate', 'steering', 'kiro', 'prompts'].includes(namespace)) {
          continue;
        }

        // A prefix form such as /sdd-spec-{phase} or /spec-* must prefix a real name.
        if (token.endsWith('-')) {
          if (!allNames.some((n) => n.startsWith(token))) unknown.add(token);
          continue;
        }
        const namespaced = token.startsWith('sdd/') && realCommands.has(token.slice(4));
        if (!realSkills.has(token) && !realCommands.has(token) && !namespaced) unknown.add(token);
      }
    }

    expect([...unknown], `unknown names referenced:\n${[...unknown].join('\n')}`).toEqual([]);
  });
});

describe('documentation — markup files are readable English', () => {
  it('no untranslated CJK fragments remain outside deliberately kept runtime literals', () => {
    const cjk = /[\u3040-\u30ff\u4e00-\u9faf]/;
    const allowed = new Set([
      // The subagents emit this literal marker; the docs quote it verbatim on purpose.
      '次のステップ',
    ]);

    const files = [
      ...markdownFiles(path.join(repoRoot, 'docs')),
      ...markdownFiles(path.join(repoRoot, 'tools', 'open-sdd', 'templates')),
    ].filter((f) => !f.includes(`${path.sep}RELEASE_NOTES${path.sep}`));

    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (!cjk.test(line)) return;
          let stripped = line;
          for (const literal of allowed) stripped = stripped.split(literal).join('');
          if (cjk.test(stripped)) offenders.push(`${path.relative(repoRoot, file)}:${index + 1}`);
        });
    }

    expect(offenders, `CJK fragments:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the archived documents are explicitly marked as archives', () => {
    const releaseNotes = readFileSync(
      path.join(repoRoot, 'docs', 'RELEASE_NOTES', 'RELEASE_NOTES_en.md'),
      'utf8',
    );
    expect(releaseNotes).toContain('Historical archive');

    const legacyReadme = readFileSync(path.join(repoRoot, 'docs', 'README', 'README_en.md'), 'utf8');
    expect(legacyReadme.toLowerCase()).toContain('legacy documentation');
  });
});

describe('documentation — the surfaces the docs promise actually exist', () => {
  it('files referenced by the README exist or are explicitly absent-and-explained', () => {
    const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
    const linked = [...readme.matchAll(/\]\(([^)#]+\.md)\)/g)].map((m) => m[1]);
    expect(linked.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const rel of linked) {
      if (/^https?:/.test(rel)) continue;
      const target = path.resolve(repoRoot, rel);
      try {
        statSync(target);
      } catch {
        missing.push(rel);
      }
    }
    expect(missing, `README links to missing files:\n${missing.join('\n')}`).toEqual([]);
  });
});

describe('documentation — the gap ids cited elsewhere exist in the report', () => {
  // Un `write` que no llegó a ejecutarse dejó el CHANGELOG citando G-35 mientras el informe no tenía
  // esa brecha: el texto seguía leyéndose bien y el enlace a la evidencia no existía. Es la misma
  // clase de fallo silencioso que la putrefacción de anclas, así que se comprueba igual.
  it('every G-NN cited outside the report is a gap the report actually declares', () => {
    const report = path.join(repoRoot, 'docs', 'PAPER-ALIGNMENT.md');
    const declared = new Set(
      [...readFileSync(report, 'utf8').matchAll(/^###\s+(G-\d\d)\b/gm)].map((match) => match[1]),
    );
    expect(declared.size).toBeGreaterThan(30);

    const files = markdownFiles(path.join(repoRoot, 'docs'))
      .concat(['README.md', 'README.es.md', 'CHANGELOG.md', 'AGENTS.md', 'CLAUDE.md'].map((f) => path.join(repoRoot, f)))
      .filter((file) => file !== report);

    const unknown: string[] = [];
    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue; // un fichero opcional que no existe no es una referencia rota
      }
      for (const match of content.matchAll(/\bG-\d\d\b/g)) {
        if (!declared.has(match[0])) unknown.push(`${path.relative(repoRoot, file)}: ${match[0]}`);
      }
    }
    expect(unknown, `referencias a brechas que el informe no declara:\n${unknown.join('\n')}`).toEqual([]);
  });
});
