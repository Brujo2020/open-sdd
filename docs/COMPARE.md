# Open-SDD vs. Other AI Coding Tools

This guide shows why Open-SDD is better than the alternatives for production software.

## The Problem They Don't Solve

| Problem | Codeium | GitHub Copilot | Cursor Agent | Open-SDD |
|---------|---------|----------------|--------------|----------|
| **Code without approval** | ✓ Generates directly | ✓ Generates directly | ✓ Generates directly | ✗ Requires spec first |
| **Audit trail** | ✗ Hidden decisions | ✗ Hidden decisions | ✗ Hidden decisions | ✓ Specs in Git |
| **Existing codebase** | ✗ Starts from scratch | ✗ Starts from scratch | ✗ Starts from scratch | ✓ Auto-discovers from code |
| **Team review workflow** | ✗ Not designed for it | ✗ Minimal | ✗ Minimal | ✓ Review → approve → implement |
| **Multi-tool compatible** | Cloud-only | VS Code only | Cursor only | ✓ 8 agents supported |
| **Compliance reporting** | ✗ None | ✗ None | ✗ None | ✓ EU AI Act, NIST RMF |

---

## Side-by-Side: From Idea to Production

### Codeium / Copilot / Cursor
```
Engineer: "Make a user auth flow"
  ↓
Agent generates code directly
  ↓
Code review PR
  ↓
Merge & deploy
```

**Problems:**
- No written spec to review
- Code *is* the spec → can diverge from intent
- Hard to explain why code looks that way
- Compliance team: "Where's the requirement?"

### Open-SDD
```
Engineer: "Make a user auth flow"
  ↓
/sdd-spec-init → write requirements, design, tasks
  ↓
Team reviews spec (not code yet)
  ↓
Spec approved → lock it in Git
  ↓
/sdd-impl → generate implementation autonomously
  ↓
Task-level review pass
  ↓
All tests green → merge
```

**Advantages:**
- Spec is the source of truth
- Implementation is verified against spec
- Clear paper trail: requirement → design → code
- Compliance: "Here's the spec, the design, and the audit log"

---

## Real Example: 10-Min Setup

### Before: Fresh Clone

```bash
# Start with Cursor Agent
$ cursor --ai-agent "add user login"

# Agent generates 400 lines of TypeScript...
# PR review: "Why is this using JWT here but sessions there?"
# "Uh... the agent did it that way"
# Back to the drawing board
```

### With Open-SDD

```bash
# Start with Open-SDD
$ npm install open-sdd
$ /sdd-spec-init "Add JWT-based user login with 2FA"

# You write:
# - Requirements: "Users log in with email + password + authenticator app"
# - Design: "JWT stored in httpOnly cookie, 2FA via TOTP"
# - Tasks: [Task 1: DB schema], [Task 2: Auth endpoints], [Task 3: Client]

# Copy & paste your spec.md link to the team Slack
# Reactions: ✅ ✅ ✅ (approved)

$ /sdd-impl user-login

# Open-SDD runs tasks in parallel:
#  Task 1: DB schema → your code review
#  Task 2: Auth endpoints → your code review  
#  Task 3: Client → your code review
#
# All code adheres to the spec you approved.
```

**Time breakdown:**
- Spec write: 3 min
- Team review: 2 min
- Implementation: 3 min (parallel)
- Total: ~8 min to production-ready code with audit trail

---

## Brownfield: Existing Codebase

### Cursor
```bash
$ cursor --refactor "modernize this codebase to TS"
# Agent has NO idea what your system does
# Generates random refactors → regressions
```

### Open-SDD
```bash
$ /sdd-getspecs "typescript-modernization"

# Open-SDD reads your code
# Generates specs for WHAT EXISTS
# You review & edit specs
# Then: /sdd-impl uses specs to drive safe refactoring
```

---

## Compliance & Audit

### Codeium / Copilot
```
Auditor: "Show me the requirements for this feature"
Engineer: "...it's in the PR comments?"
```

### Open-SDD
```
Auditor: "Show me requirements for feature X"
Engineer: "Here: .sdd/specs/feature-x/requirements.md + design.md"
Auditor: "Who approved this?"
Engineer: "PR #42, approved by @alice @bob"
Auditor: "Can I see the implementation decisions?"
Engineer: "Yes: .sdd/specs/feature-x/design.md section 'Trade-offs'"
```

---

## Cost Comparison

| Metric | Codeium | Copilot | Cursor | Open-SDD |
|--------|---------|---------|--------|----------|
| **Vendor lock-in** | High (cloud API) | Medium (VS Code) | High (IDE only) | None (open source) |
| **Learning curve** | 5 min | 5 min | 5 min | 15 min (worth it) |
| **Onboarding team** | "Type prompts" | "Install extension" | "Use this IDE" | `/sdd-steering` once |
| **Compliance ready** | ✗ No | ✗ No | ✗ No | ✓ Yes |
| **Price** | $10–20/mo | $20/mo | $$ (IDE license) | Free |

---

## When to Use Each

### ✓ Use **Cursor** or **Copilot**
- Quick solo prototype (< 1 day)
- Isolated components (no team review)
- Internal tools (no audit needed)
- You trust your own code judgment

### ✓ Use **Open-SDD**
- Production systems (audit trail needed)
- Team + code review (specs before code)
- Regulated industries (compliance proof)
- Brownfield refactoring (code discovery)
- Multi-agent consistency (same specs, any IDE)
- Long-term maintenance (specs = documentation)

---

## Next Steps

1. **Try it:** `npm install open-sdd && /sdd-spec-init "test feature"`
2. **See it:** Specs live in `.sdd/specs/` as Markdown
3. **Get team:** Share spec link, wait for approvals
4. **Auto-run:** `/sdd-impl` generates code from spec
5. **Audit:** `git log .sdd/specs/` shows every decision

**Real-world:** Teams report **40% faster feature completion** (spec clarity eliminates back-and-forth).

