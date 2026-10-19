# 5-Minute Runnable Example

This is **not** documentation. This is a real, copy-paste-able workflow you can run right now.

## Setup (1 min)

```bash
# Create a test project
mkdir my-auth-feature
cd my-auth-feature
git init
npm install open-sdd
```

## Write a Spec (2 min)

Open-SDD is installed. Now tell it what to build:

```bash
/sdd-spec-init "Add JWT authentication with refresh tokens"
```

You'll see a prompt. Choose:
1. `claude-code` (if you use Claude in your IDE) — OR
2. `--claude-skills` (if you use a skills-based setup)

Answer these questions (takes ~1 min):
- What should the feature do? → `Users log in with email/password, get JWT + refresh token`
- Who's the user? → `Backend engineers, need to integrate into Express app`
- Constraints? → `Use RS256 for JWT, store refresh token in Redis`

Open-SDD generates:
```
.sdd/specs/jwt-auth/
├── requirements.md  (what it does)
├── design.md        (how it works)
├── tasks.md         (to-do list)
└── spec.json        (metadata)
```

## Review the Spec (1 min)

```bash
cat .sdd/specs/jwt-auth/requirements.md
cat .sdd/specs/jwt-auth/design.md
```

Edit if needed:
```bash
# Your favorite editor
vim .sdd/specs/jwt-auth/design.md
```

## Approve & Generate Code (1 min)

```bash
/sdd-impl jwt-auth
```

Open-SDD reads your spec and generates the code:
- Task 1: Data models (runs in parallel)
- Task 2: Auth endpoints (runs in parallel)
- Task 3: Middleware (runs in parallel)

Each task shows:
```
✓ Task 1 generated → review & approve
✓ Task 2 generated → review & approve
✓ Task 3 generated → review & approve
```

## See the Results

```bash
# Your code
ls src/
# → auth.ts, models.ts, middleware.ts

# The spec (in Git)
git log .sdd/specs/jwt-auth/
# → Full audit trail of decisions

# The governance status
/sdd-audit jwt-auth
# → Checks: ✓ Code follows approved spec, ✓ Design locked
```

---

## What Just Happened?

| Step | Tool | Output |
|------|------|--------|
| 1. Spec init | `/sdd-spec-init` | `.sdd/specs/jwt-auth/` (Markdown in Git) |
| 2. Review | Your editor + team | Spec approved, merged to main |
| 3. Implement | `/sdd-impl` | Code generated from spec |
| 4. Audit | `/sdd-audit` | ✓ Code matches spec |

**No ambiguity. No "why did the agent do this?" No hidden decisions.**

---

## Next: Real Project

Replace `jwt-auth` with your actual feature name and run the same flow in your repo.

```bash
cd your-project
/sdd-spec-init "your feature description"
# ... review ...
/sdd-impl your-feature-name
```

**That's it.**

---

## Troubleshooting

- **`/sdd-spec-init` not found?** → Run `/sdd-help` to see all commands
- **Specs in weird place?** → Check `.sdd/settings/governance.json`
- **Want stricter checks?** → Change `"profile": "solo"` to `"team"` or `"enterprise"`

