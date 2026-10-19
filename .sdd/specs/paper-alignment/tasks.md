# Implementation Plan

## Task Format

A task is a single checkbox line carrying its metadata inline:

    [x] <id>. <description> — _Requirements: <ids>_ — _Depends:_ `<ids>`_ — _Boundary:_ `<paths>`_

`_Depends:_` and `_Boundary:_` are parsed by `tools/open-sdd/src/core/specManager.ts` and must be the
last metadata groups on the line. Completed tasks carry an `_Evidence:` bullet with the captured
output that would have falsified them (invariant I2).

---

## Tasks

- [x] 1. Restore the deleted product from git history and confirm the baseline — _Requirements: 1_ — _Boundary:_ `.`_
  - `git checkout HEAD~1 -- .` restores 673 tracked files.
  - Observable completion: the restored build compiles and the pre-existing suite passes untouched.
  - _Evidence: `npm --prefix tools/open-sdd run build` → exit 0 (Ensured shebang and exec bit on …/dist/cli.js); `npm --prefix tools/open-sdd test` → 47 files, 233 tests passed, 1.46s._

- [x] 2. Fix the recursive, failure-masking root postinstall — _Requirements: 1_ — _Boundary:_ `package.json`, `scripts`_
  - A guarded Node script replaces the `cd … || npm install` shell chain and propagates failures.
  - Observable completion: an absent workspace exits 0 with a message and spawns no nested install.
  - _Evidence: `scripts/postinstall.mjs` prints "workspace tools/open-sdd is not present; skipping dependency install" and exits 0; replica without tools/ finished in 248ms, zero child npm install processes (previously 81 concurrent after 8s)._

- [x] 3. Make the package publishable and the installers coherent — _Requirements: 1_ — _Boundary:_ `install.sh`, `install-global.sh`, `package.json`_
  - `install.sh` drives the shipped CLI instead of copying into a `src/cli/` layout that never existed.
  - `install-global.sh` clones the URL declared in `package.json` and points the alias at the real CLI.
  - _Evidence: `npm pack --dry-run --ignore-scripts` → 495 files, 622.6 kB package, 2.5 MB unpacked (previously 2 files / 1.2 kB); `bash -n install.sh` and `bash -n install-global.sh` → exit 0._

- [x] 4. Encode the 21-gate taxonomy and the executable chain — _Requirements: 2, 3_ — _Boundary:_ `tools/open-sdd/src/core/gateCatalog.ts`_
  - Tables 33/34/35/36 as typed data, with the three admission criteria per gate.
  - Observable completion: the catalog exposes 21 logical gates and 14 chain entries.
  - _Evidence: `gates crosswalk` renders "21 controles lógicos · 13 ejecutables · 1 vacíos · 16 cubiertos · 5 en el residuo"._

- [x] 5. Resolve the chain from catalog, profile and signals — _Requirements: 2_ — _Depends:_ `4`_ — _Boundary:_ `tools/open-sdd/src/core/gateCatalog.ts`_
  - The executor must not be able to run a disabled control or omit an enabled one.
  - Observable completion: solo resolves the constant core, team nine, regulated twelve.
  - _Evidence: `gates chain --profile solo|team|regulated` → "Declarados: 7 / 9 / 12", derived from declared profile policy plus repository signals._

- [x] 6. Compute the crosswalk residue by subtraction — _Requirements: 3_ — _Depends:_ `4`_ — _Boundary:_ `tools/open-sdd/src/core/gateCatalog.ts`_
  - A curated residue can claim a control the running code does not implement.
  - Observable completion: the residue contains exactly the five uncovered logical controls.
  - _Evidence: `gates crosswalk` residue lists G7, G8, G10, G11, G17 with their retirement destinations and Table 36 reasons; covered reports 16 of 21._

- [x] 7. Model enforcement levels, per-host ceilings and the behavioural sentinel — _Requirements: 5_ — _Boundary:_ `tools/open-sdd/src/core/enforcement.ts`_
  - Level A is borrowed; B and C are owned and form the floor. A hook that dies is fail-open.
  - Observable completion: the floor always contains B and C; A enters only after a sentinel.
  - _Evidence: `gates enforcement` renders the levels with ownership, ten per-tool ceilings and the fail-open warning for exit 1._

- [x] 8. Implement the default-FAIL posture with the hard subset — _Requirements: 4_ — _Depends:_ `7`_ — _Boundary:_ `tools/open-sdd/src/core/enforcement.ts`_
  - An absent sensor is never read as an approved verification; a scanner that found something never self-authorizes.
  - _Evidence: `applyDefaultFail` covered by the new unit tests; `gates run --profile regulated` reports auto-authorized controls explicitly._

- [x] 9. Encode invariants I1–I6 and conformity C0–C3 — _Requirements: 6_ — _Boundary:_ `tools/open-sdd/src/core/invariants.ts`_
  - Conformity is assessed from evidence; C3 additionally requires a measured false-positive rate.
  - _Evidence: `govern conformance` → "Nivel declarado: C1 (Con suelo)", with I4 and I5 reported as not satisfied._

- [x] 10. Add the relaxation ledger and the appeal channel — _Requirements: 6_ — _Boundary:_ `tools/open-sdd/src/core/receipts.ts`_
  - Every relaxation is an event with actor, reason and target hash; a sustained override rate moves a gate to design review.
  - _Evidence: `govern appeal` renders the ledger and per-gate calibration; `makeReceipt` rejects an empty actor, reason or hash._

- [x] 11. Add quantified HITL thresholds and rigor selection — _Requirements: 6_ — _Boundary:_ `tools/open-sdd/src/core/hitl.ts`_
  - Table 25 defaults, the escalation calibration loop and the §4.8/§4.10 rigor decision.
  - _Evidence: `govern hitl` and `govern rigor` render the thresholds and the selected mode with its reason._

- [x] 12. Implement the EARS validator and the Triad/evidence-lock checks — _Requirements: 4_ — _Boundary:_ `tools/open-sdd/src/core/ears.ts`, `tools/open-sdd/src/core/triad.ts`_
  - Five templates with `shall` mandatory; a completed task without captured evidence is rejected.
  - _Evidence: `gates run C1` and `gates run C3` execute these checks against this specification's own Triad._

- [x] 13. Implement transactional waves and the scope contract — _Requirements: 7_ — _Boundary:_ `tools/open-sdd/src/core/waves.ts`_
  - One failing task discards the whole wave; no intermediate state is observable.
  - _Evidence: `waves paper-alignment` renders the wave plan, declared scope, worktrees and create/verify/merge/discard commands; `resolveWave` covered by tests._

- [x] 14. Implement META-EVAL, memory anti-poisoning and the skills privilege rule — _Requirements: 8, 9_ — _Boundary:_ `tools/open-sdd/src/core/metaEval.ts`, `tools/open-sdd/src/core/memory.ts`, `tools/open-sdd/src/core/skills.ts`_
  - Cohen's κ with its pre-registered sample size; quarantine plus provenance on promotion; no skill widens reachable MCP servers.
  - _Evidence: `govern meta-eval`, `assure memory` and `assure skills` render the controls; `decidePromotion` and `checkMcpPermissions` covered by tests._

- [x] 15. Add telemetry, budgets, the claims registry and assurance mappings — _Requirements: 10_ — _Boundary:_ `tools/open-sdd/src/core/telemetry.ts`, `tools/open-sdd/src/core/claims.ts`, `tools/open-sdd/src/core/assurance.ts`_
  - The 30% governance ceiling with its degradation order, the five-state claims registry and the threat/regulatory crosswalks.
  - _Evidence: `govern budget`, `assure claims`, `assure lab` and `assure threats` render the models; `evaluateClaim` and `assessClaims` covered by tests._

- [x] 16. Wire the governance console into the CLI — _Requirements: 2, 3, 10_ — _Boundary:_ `tools/open-sdd/src/cli/commands`, `tools/open-sdd/src/index.ts`_
  - `gates`, `govern`, `assure` and `waves` dispatched alongside the existing commands without regressing them.
  - _Evidence: `gates chain --profile team`, `govern conformance`, `assure threats` and `waves paper-alignment` all exit 0 and render expected output; `--help` documents them._

- [x] 17. Add the regression suite for the new modules — _Requirements: 2, 3, 4, 5, 6, 7, 8, 9, 10_ — _Depends:_ `4`, `8`, `10`, `13`, `14`_ — _Boundary:_ `tools/open-sdd/test`_
  - Focused unit tests per module, with the profile counts and the wave-atomicity guarantee as first-class assertions.
  - Observable completion: the whole suite (existing plus new) is green.
  - _Evidence: `npm --prefix tools/open-sdd test` → 62 files, 470 tests passed; 15 new test files added (236 new tests) alongside the 233 pre-existing ones._

- [x] 20. Fix the defects the new suite exposed — _Requirements: 2, 4, 6, 8, 9_ — _Depends:_ `17`_ — _Boundary:_ `tools/open-sdd/src/core`_
  - The suite found eight real defects in the new modules; each was fixed at the source and the characterization tests were updated to the corrected behaviour.
  - Observable completion: every fix is exercised by a test that asserts the corrected outcome.
  - _Evidence: `npm --prefix tools/open-sdd test` → 62 files, 470 passed, 0 failed. Fixes: destructive-command regex missing `rm -rf /` at end of input; `applyDecay` inverting the usage ternary; `MULTIPLE_TEMPLATES` unreachable (anchored keywords) → now counted in the trigger clause; vague-term matching firing inside ordinary words; `guaranteeLeaks` structurally always empty; `landisKoch(NaN)` reporting the strongest band → now a distinct `undefined` band; invalid MCP concessions mislabelled as expired; level D in the floor tripping the I3 guard. Additionally `assertFloorIsOwned` now derives ownership from the floor levels instead of trusting a precomputed flag._

- [x] 18. Align documentation with the implementation and publish the traceability report — _Requirements: 10_ — _Depends:_ `16`_ — _Boundary:_ `README.md`, `docs`, `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md`_
  - Rewrite the stale README, fix the documented paths, and record every paper-to-code mapping with its status label and the honest gaps.
  - Observable completion: the claims registry verifiers are executed from the repository root and their results recorded.
  - _Evidence: `README.md` rewritten (real bin entries, 18 agent definitions, both profile axes, console, "what this port does not do"); `docs/PAPER-ALIGNMENT.md` (383→400 lines) records the G1–G21 → C1–C7/O1–O7 → crosswalk → residue tables, a ~30-row component map with symbols and status labels, and 14 numbered gaps G-01…G-14; `docs/QUICK-START.md` and `docs/INSTALLATION.md` created; `CLAUDE.md`/`AGENTS.md` corrected (templates under `tools/open-sdd/templates/agents/<agent>/skills/`, 160 SKILL.md, prefix `sdd-`); `CHANGELOG.md` extended. Stale strings (`src/cli/index.ts`, "9 Production-Ready", `.claude/skills/` as a source path) verified absent as fact._

- [x] 21. Make the claims registry executable and the repository pass its own gate — _Requirements: 4, 10_ — _Depends:_ `15`, `16`_ — _Boundary:_ `tools/open-sdd/src/core/claimsRegistry.ts`, `tools/open-sdd/test/coreClaimsRegistry.test.ts`, `.sdd/specs/paper-alignment/requirements.md`_
  - `assure claims --verify` runs every verifier in `docs/claims/paper-claims.yaml` and decides each claim by exit code, so the registry stops being a documentation artifact.
  - The repository's own `gates run` must pass on its own specification.
  - _Evidence: `node tools/open-sdd/dist/cli.js assure claims --verify` → "35 afirmaciones | 31 verificadas | 0 declaradas | 3 no medidas | 0 rotas | 1 desactualizadas", exit 0; `node tools/open-sdd/dist/cli.js gates run` → "La cadena pasa", exit 0. Two defects were found and fixed on the way: the runner used a login shell (`bash -lc`) whose profile can change the working directory, and the YAML parser unescaped backslashes inside single-quoted scalars — together they reported 17 working controls as broken. The two genuinely compound requirements in this spec were split, and the trigger rule was tightened to clause starts so ordinary English ("passes where the text declared an absence") is not flagged._

- [x] 22. Expose the §9.7 decidable discipline and stop the console from being misread — _Requirements: 4_ — _Depends:_ `15`, `16`_ — _Boundary:_ `tools/open-sdd/src/cli/commands/paper.ts`, `tools/open-sdd/src/core/triad.ts`_
  - `govern discipline` runs the decidable properties over the working diff and exits 1 on a decidable violation; `gates chain` no longer prints "No implementados: 0" as if the prototype's declared-vs-executed gap had been closed.
  - Observable completion: a property nobody inspects is reported as not measurable, never as `ok`.
  - _Evidence: `node tools/open-sdd/dist/cli.js govern discipline` → diff-budget evaluated against the declared budget, scope-containment `no medible` without `SDD_SCOPE`, declared-uncertainty `no medible` (needs the assumption register); `declared-uncertainty` was changed from `decidable: true` to `decidable: false` precisely because reporting `ok` for an uninspected property is activation without measurement. `npm --prefix tools/open-sdd test` → 63 files, 481 passed._

- [x] 23. Install the owned enforcement floor instead of declaring it — _Requirements: 5, 6_ — _Depends:_ `7`, `8`_ — _Boundary:_ `tools/open-sdd/templates/hooks`, `.github/workflows`, `scripts/install-hooks.mjs`, `tools/open-sdd/src/core/securityAllowlist.ts`, `tools/open-sdd/src/core/floorInstallation.ts`_
  - Level B: a pre-commit hook that runs C1/C2/C3 over the staged index and fails closed when the CLI is missing.
  - Level C: a pull-request workflow that runs the chain against the PR diff, the suite, the claims registry and the floor report.
  - False positives are declared per (path, pattern) with a reason and reported on every run, never suppressed silently.
  - Observable completion: the hook blocks a real secret and an unproven completion, passes a clean change, and `floor status` exits 0 only when both boundaries are installed.
  - _Evidence: hook behaviour verified by running it — a staged AWS key + GitHub token → exit 1, C2 fail, 4 findings; a clean file → exit 0; an allow-listed fixture → exit 0 with "8 hallazgo(s) suprimido(s) por la lista de excepciones"; a completed task with no _Evidence: → exit 1, C3 fail. `node tools/open-sdd/dist/cli.js floor status` → exit 0, "Suelo instalado". 13 new tests in `test/enforcementFloor.test.ts`; suite 63 → 64 files, 481 → 494 tests._

- [x] 24. Teach the Zero-Trust console to the shipped agent skills — _Requirements: 2, 3_ — _Depends:_ `16`_ — _Boundary:_ `tools/open-sdd/templates/agents/\*/skills/sdd-help/SKILL.md`_
  - The 20 skills an install copies into a target project must tell the agent that the console exists, or the model is invisible to the very agents it governs.
  - Observable completion: every skills-based agent ships the console reference, and the eight copies stay identical.
  - _Evidence: the console section was appended to all 8 `sdd-help/SKILL.md` files (claude-code, cursor, codex, gemini-cli, github-copilot, opencode, windsurf, antigravity); `md5` reports 1 distinct variant across the 8, so the copies cannot drift apart._

- [x] 25. Purge the legacy naming from the guides and the shipped templates — _Requirements: 10_ — _Boundary:_ `docs/guides`, `tools/open-sdd/templates`_
  - The restored docs and templates still used the previous product's `kiro-` / `kiro:` / `/kiro/` prefixes, named commands that no longer exist, and carried untranslated Japanese fragments.
  - Observable completion: every referenced command and skill matches the shipped templates, no internal anchor is broken, and no unexplained legacy token remains.
  - _Evidence: 588 replacements across 40 files (`kiro-spec-impl` → `sdd-impl`, `/kiro:spec-init` → `/spec-init`, `/kiro/spec-impl` → `/sdd/spec-impl`, `{{KIRO_DIR}}` → `{{SDD_DIR}}`, `.kiro/` → `.sdd/`, `@kiro-` → `@sdd-`, `agent: kiro/` → `agent: sdd/`). A name audit found 0 unknown skill/command tokens; an anchor audit found and fixed 39 broken links and now reports 0; 52 Japanese fragments were translated (the literal `次のステップ` marker was deliberately kept, with justification, because the runtime emits it). Remaining `kiro` references are the supported `--kiro-dir` alias, the archived release notes and legacy README, and the migration guide's deliberate before-column._

- [x] 26. Unify the release identity and protect it with guards — _Requirements: 1, 10_ — _Depends:_ `18`, `23`_ — _Boundary:_ `package.json`, `tools/open-sdd/package.json`, `.github/workflows/publish.yml`, `docs/INSTALLATION.md`_
  - After the rename to `@brujo2020/open-sdd` the repository had two publishable manifests and the release pipeline published the wrong one.
  - Observable completion: exactly one publishable package, a private workspace, a pipeline that publishes the root with public access and cannot run from the workspace, and documentation that advertises only names that resolve.
  - _Evidence: `publish.yml` now runs build + test + `gates run` + `assure claims --verify`, asserts `@brujo2020/open-sdd`, and publishes from the root with `--access public --provenance`; `tools/open-sdd/package.json` is `private: true`; `install:global` installs the root; 12 documentation install commands corrected across 5 files. 10 new tests in `test/releaseIntegrity.test.ts`. Writing the guards exposed a real parser bug: `claimsRegistry.ts` unescaped YAML double-quoted strings in sequence, so `\\n` became a backslash plus a newline and split a verifier across lines — fixed with a single-pass unescape, found by a new claim failing as `broken`. Suite 65 → 66 files, 500 → 510 tests; claims 40 → 43, 0 broken. Packing the tarball and installing it into a throwaway prefix exposed a further defect the source tree hid: `--version` printed `vdev` because the CLI read a manifest that is deliberately not shipped — fixed by resolving the package root manifest first, and the noisy consumer `postinstall` now exits silently. Verified against the installed artifact: four binaries present, `--version` → `open-sdd v3.0.2`, `gates chain --profile team` → 9 controls. 13 tests; claims 43 → 44, 0 broken._

- [x] 19. Verify the end state and freeze the milestone — _Requirements: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10_ — _Depends:_ `17`, `18`, `20`, `21`, `22`_ — _Boundary:_ `.`_
  - Full build, full test suite, package dry-run, postinstall guard and a claims-registry re-run on the frozen tree.
  - _Evidence: `npm run verify` → build exit 0, 63 test files / 481 tests passed. `gates chain --profile solo|team|regulated` → 7/9/12 declared. `gates crosswalk` → 21 logical, 13 executable, 1 vacuous, 16 covered, 5 residue. `gates run` → exit 0, "La cadena pasa". `govern conformance` → C1. `audit paper-alignment` → 0 ambient-drift warnings. `assure claims --verify` → 35 claims, 32 verified, 0 broken, 0 outdated, exit 0. `npm pack --dry-run` → 496 files, 628.6 kB. Postinstall guard on a tree without `tools/open-sdd` → exit 0, no nested install (was 81 concurrent processes)._
