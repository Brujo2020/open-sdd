# GitHub Repo Structure for open-sdd

```
marioalej/open-sdd (GitHub repo)
├── install.sh                          ← Main installer (curl-friendly)
├── README.md                           ← Landing page
├── LICENSE                             ← MIT
├── package.json                        ← name: "open-sdd", version: "1.0.0"
├── tsconfig.json                       ← TypeScript config
│
├── src/cli/
│   ├── index.ts                        ← Router (user wires imports here)
│   │
│   ├── core/
│   │   ├── earsConverter.ts            ← Feature 2
│   │   ├── failureRecovery.ts          ← Feature 3
│   │   ├── specVersioning.ts           ← Feature 5
│   │   ├── specRefinement.ts           ← Feature 6
│   │   ├── orchestrator.ts             ← Feature 7
│   │   ├── profiler.ts                 ← Feature 8
│   │   └── gitIntegration.ts           ← Feature 9
│   │
│   ├── ui/
│   │   ├── diffPreviewUI.ts            ← Feature 1 UI
│   │   └── earsConverterUI.ts          ← Feature 2 UI
│   │
│   ├── commands/
│   │   ├── spec-ears-strict.ts         ← Feature 2 handler
│   │   └── rollback-retry.ts           ← Feature 3 handler
│   │
│   └── ... (other feature files)
│
├── docs/
│   ├── FEATURES.md                     ← 9 features explained
│   ├── ARCHITECTURE.md                 ← Design deep-dive
│   └── EXAMPLES.md                     ← Usage patterns
│
└── .github/
    └── workflows/
        └── build.yml                   ← CI: npm run build
```

---

## One-Line Install

```bash
curl -fsSL https://github.com/marioalej/open-sdd/raw/main/install.sh | bash -s /path/to/open-sdd
```

---

## Then Wire Router

Edit `src/cli/index.ts` and add 3 imports:

```typescript
import { handleSpecEARSStrict } from "./commands/spec-ears-strict.js";
import { handleRollbackRetry } from "./commands/rollback-retry.js";
```

Add 2 cases to switch:

```typescript
case "/sdd-spec-ears-strict":
  await handleSpecEARSStrict(args);
  break;

case "/sdd-impl":
  if (args.includes("--rollback-to") || args.includes("--resume"))
    await handleRollbackRetry(args);
  else
    // existing logic
  break;
```

---

## Test

```bash
npm run build
/sdd-impl auth --preview
```

---

## CI/CD (.github/workflows/build.yml)

```yaml
name: Build

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm install chalk
      - run: npm run build
```

---

## Files to Push to GitHub

1. Copy all `src/cli/` files
2. Copy `install.sh`
3. Create `README.md` with one-liner
4. Copy `package.json` + `tsconfig.json`
5. Add `.github/workflows/build.yml`
6. Create `LICENSE` (MIT)

**Total size: ~150 KB (no node_modules)**

---

## Result

```bash
# User does ONE thing:
curl -fsSL https://github.com/marioalej/open-sdd/raw/main/install.sh | bash -s /path/to/open-sdd

# 30 seconds later:
✅ All 9 features installed
✅ Dependencies installed
✅ Build passes
❌ User wires 3 imports (copy-paste, 1 min)
✅ Ready to test
```

That's it. 🎯
