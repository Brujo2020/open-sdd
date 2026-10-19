---
description: Refactor without changing behaviour — declare spec_impact none, prove it with the same tests before and after
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
argument-hint: <area to refactor>
---

# Refactor (no behaviour change)

<instructions>
## Why this flow exists
A refactor needs no new requirements, but "no behaviour change" is a claim, and claims need evidence. This flow
declares the claim (`spec_impact: none`), bounds the area, and proves it with the same tests green before and after.
If the evidence says behaviour changed, it is no longer a refactor. (SteelForge `/sdd-refactor`.)

## Steps
1. Declare the marker: `"spec_impact": "none"` in `{{SDD_DIR}}/specs/<feature>/spec.json` (create the feature if
   needed) and the touched area in `tasks.md` as `_Boundary:_ \`path\``.
2. BEFORE: run the tests covering that area and save the output. If no test covers it, run `/sdd:characterize` first.
3. Refactor without changing observable behaviour (outputs, errors, side effects, public API).
4. AFTER: run the same tests; they must be green with the same results. Cite them as `_Evidence:_`.
5. Run `open-sdd brownfield impact <feature>`; if it reports a behaviour change, either show why it is not one or
   reclassify the work as a change (`open-sdd delta init`).
</instructions>
