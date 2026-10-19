---
description: Promote a tinyspec to a governed spec — its goal and done-when become EARS requirements
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
argument-hint: [feature]
---

# Promote a tinyspec

<instructions>
## Why this flow exists
A spike that survives becomes production code. Without a promotion step its only spec is three lines, and the
governed ladder (`spec-first` and up) would be silently skipped. Promotion turns what the spike proved into
checkable requirements, keeping `tiny.md` as the origin.

## Steps
1. Read `{{SDD_DIR}}/specs/<feature>/tiny.md` (the most recent one if `$ARGUMENTS` is empty).
2. Turn the Goal and each "Done when" into EARS acceptance criteria under `### REQ-…` headings. Show a table
   `tinyspec line → EARS criterion → what is still missing` and ask only what is missing (max 3, with options).
3. With the user's approval, write `requirements.md` in the same folder and `spec.json` with phase
   `requirements-drafted`. Keep `tiny.md`.
4. Run `open-sdd requirements review <feature>` and fix every finding with the user.
5. Recommend the rigor level (`open-sdd modes`) and continue with `/sdd:spec-design <feature>`.
</instructions>
