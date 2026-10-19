# Plan — tool-maturity

## Design decisions

- **ADR-MAT-001 — MCP first, adapters second.** The engine already isolates its checks in `core/`
  behind pure functions. The agnostic integration surface is one MCP server over stdio plus `--json`
  on every command, so any host (Claude Code, Cursor, Copilot, Zed, Antigravity, custom) integrates
  without per-host code. Per-host skills stay templates, not dependencies.
- **ADR-MAT-002 — The constitution is the pivot, enforced.** `specConstitution.ts` already validates a
  spec against the principles in force. The change is to make it blocking (`--check --strict`), to
  ratchet it, and to make waivers expire. A reported violation with no consequence is a document.
- **ADR-MAT-003 — One boundary vocabulary.** The module map and the constitution must derive their
  boundaries from the same source (`scanProject` workspace roots + source dirs), closing gap G-22.
- **ADR-MAT-004 — Fail closed, offline by default.** No model backend, no network: every check is
  decidable from artifacts. Anything undecidable is reported as not inspected, never as a pass.
- **ADR-MAT-005 — Enterprise and non-enterprise are the same tool with a different level.** The rigor
  ladder already expresses this: `spec-first` for a small team, `spec-as-source` for regulated work.

## Waves

1. **Wave 1 — Reach and installation (REQ-MAT-001, 002, 004, 008).** MCP server, `init`/`doctor`,
   cross-platform hook, distribution. Without this the tool cannot be adopted.
2. **Wave 2 — Enforcement (REQ-MAT-005, 006, 007, 012).** Strict alignment, ratchet, audit bundle,
   CI pack, expiring waivers. This is what makes it mandatory rather than optional.
3. **Wave 3 — Truth of the evidence (REQ-MAT-003, 010, 013).** Multi-language discovery, one boundary
   vocabulary, manifest-aware API surface, impact forecast, enforced reuse-first.
4. **Wave 4 — Experience (REQ-MAT-009, 011, 014, 015).** Tour, bilingual output, adhesion trend,
   context pack, operable spec-as-source.

5. **Wave 5 — A constitution that is born and stays alive (REQ-MAT-016, 017).** The drafter and the
   advisor. Design constraint: no model backend ships, so the assistant is split honestly — the engine
   assembles the EVIDENCE PACK (stack facts, observed practices, candidate principles with the file
   that proves each one, and the diff of what is missing) and the HOST model writes the prose; the
   engine then validates whatever comes back with the same `validateConstitution` rules and keeps
   unratified principles out of blocking verdicts. That is an AI assistant that works with any host,
   offline, and cannot launder a hallucinated principle into authority.

## Risks

- **Adapter sprawl**: resist per-host plugins; the MCP surface is the contract.
- **Enforcement backlash**: default stays `spec-first` and fluid; strictness is opted into per level.
- **A draft that becomes authority by accident**: draft principles are marked and excluded from
  blocking verdicts until a named human ratifies them; the marker is checked, not trusted.
- **False positives** (G-19 class): a noisy gate is ignored, so each wave must measure its own
  false-positive rate on this repository before it is wired into CI.
