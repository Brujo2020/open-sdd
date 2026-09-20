# open-sdd

**9 Production-Ready SDD Features. One Command. Zero Friction.**

[![Build](https://github.com/marioalej/open-sdd/actions/workflows/build.yml/badge.svg)](https://github.com/marioalej/open-sdd/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

---

## 🚀 Install Now

```bash
curl -fsSL https://github.com/marioalej/open-sdd/raw/main/install.sh | bash -s /path/to/open-sdd
```

**That's it.** Everything else is automatic.

---

## ✨ What You Get

**3,360 LOC | 0 Build Errors | TypeScript Strict Mode**

| # | Feature | What | Command |
|---|---------|------|---------|
| 1 | **Diff Preview** | See changes before implementing | `--preview` |
| 2 | **EARS Strict** | Auto-format requirements | `/sdd-spec-ears-strict` |
| 3 | **Rollback & Retry** | Smart failure recovery | `--checkpoint` |
| 4 | **Spec Versioning** | Track spec iterations + diffs | `/sdd-spec-version` |
| 5 | **Spec Refinement** | Auto-detect gaps + risks | `/sdd-spec-refine` |
| 6 | **Orchestration** | Run 5+ features coordinated | `/sdd-orchestrate` |
| 7 | **Performance Profiler** | Real metrics + bottlenecks | `--profile` |
| 8 | **Git Integration** | Auto-commit per wave + tags | `--git` |

---

## 🎯 Quick Examples

```bash
# See what will change
/sdd-impl auth --preview

# Format vague requirements automatically
/sdd-spec-ears-strict auth

# Run with auto-rollback on failure
/sdd-impl auth --checkpoint

# Measure performance
/sdd-impl auth --profile

# Auto-commit per wave + tagging
/sdd-impl auth --git

# Orchestrate 3+ features
/sdd-orchestrate auth payment billing --git --profile --checkpoint
```

---

## 📋 After Install

1. **Wire 3 imports** in `src/cli/index.ts` (copy-paste ready):
   ```typescript
   import { handleSpecEARSStrict } from "./commands/spec-ears-strict.js";
   import { handleRollbackRetry } from "./commands/rollback-retry.js";
   ```

2. **Add 2 cases** to router switch (see docs for exact code)

3. **Build & test:**
   ```bash
   npm run build
   /sdd-impl auth --preview
   ```

Done. All 9 features active.

---

## 📊 Performance

- **Installation time:** <30 seconds
- **File cache:** ~70% I/O reduction (5s TTL)
- **Bottleneck detection:** Auto-flag waves >5s
- **Package size:** 36 KB (compressed)
- **Build:** 0 warnings, 0 errors

---

## 🏗️ Architecture

**Core Modules (all in `src/cli/core/`)**

- `earsConverter.ts` (281 LOC) — Requirement parsing + validation
- `failureRecovery.ts` (459 LOC) — Checkpoint + rollback + retry
- `specVersioning.ts` (279 LOC) — Version tracking + diff analysis
- `specRefinement.ts` (263 LOC) — Gap detection + auto-suggestions
- `orchestrator.ts` (234 LOC) — Multi-feature execution + dependency resolution
- `profiler.ts` (256 LOC) — Real-time metrics + comparison
- `gitIntegration.ts` (217 LOC) — Auto-commit + tagging + PR creation

**CLI Handlers (in `src/cli/commands/`)**

- `spec-ears-strict.ts` — Feature 2 orchestrator
- `rollback-retry.ts` — Feature 3 orchestrator

---

## 🛠️ For Developers

**Clone & develop:**
```bash
git clone https://github.com/marioalej/open-sdd.git
cd open-sdd
npm install chalk
npm run build
```

**Test all features:**
```bash
npm test
```

**CI/CD runs on every push** (GitHub Actions)

---

## 📚 Documentation

- **[FEATURES.md](./docs/FEATURES.md)** — Deep dive on each feature
- **[ARCHITECTURE.md](./docs/ARCHITECTURE.md)** — Design decisions + optimization
- **[EXAMPLES.md](./docs/EXAMPLES.md)** — Real-world usage patterns

---

## 🤝 Credits

**Built by:** Mario Alejandro — Principal Innovation Advisor, NTT DATA  
**Foundation:** open-sdd (Spec-Driven Development methodology)  
**Partnership:** GotaLab  

---

## 📄 License

MIT License — See [LICENSE](./LICENSE)

---

## 🎯 Why Open-SDD?

| vs Copilot | vs Codeium | vs Cursor | vs Manual |
|-----------|-----------|----------|----------|
| ❌ Diff Preview | ❌ Diff Preview | ❌ Diff Preview | ✅ |
| ❌ EARS Format | ❌ EARS Format | ❌ EARS Format | ✅ |
| ❌ Rollback/Retry | ❌ Rollback/Retry | ❌ Rollback/Retry | ✅ |
| ❌ Versioning | ❌ Versioning | ❌ Versioning | ✅ |
| ❌ Refinement | ❌ Refinement | ❌ Refinement | ✅ |
| ❌ Orchestration | ❌ Orchestration | ❌ Orchestration | ✅ |
| ❌ Profiling | ❌ Profiling | ❌ Profiling | ✅ |
| ❌ Git Native | ❌ Git Native | ❌ Git Native | ✅ |

**Open-SDD: All 8. Built in.**

---

**Ready to ship spec-driven development at scale? Start here:** ⬆️

🚀 **Zero friction. Maximum impact.**
