---
description: Manage {{SDD_DIR}}/steering/ as persistent project knowledge
agent: sdd/steering
subtask: true
---

# Kiro Steering Management

## Mode Detection

**Perform detection before invoking Subagent**:

Check `{{SDD_DIR}}/steering/` status:
- **Bootstrap Mode**: Empty OR missing core files (product.md, tech.md, structure.md)
- **Sync Mode**: All core files exist

Use Glob to check for existing steering files.

## Subagent Context

Mode: {bootstrap or sync based on detection}

File patterns to read:
- {{SDD_DIR}}/steering/*.md (if sync mode)
- {{SDD_DIR}}/settings/templates/steering/*.md
- {{SDD_DIR}}/settings/rules/steering-principles.md

JIT Strategy: Fetch codebase files when needed, not upfront

## Display Result

Show Subagent summary to user:

### Bootstrap:
- Generated steering files: product.md, tech.md, structure.md
- Review and approve as Source of Truth

### Sync:
- Updated steering files
- Code drift warnings
- Recommendations for custom steering

## Notes

- All `{{SDD_DIR}}/steering/*.md` loaded as project memory
- Templates and principles are external for customization
- Focus on patterns, not catalogs
- "Golden Rule": New code following patterns shouldn't require steering updates
- Avoid documenting agent-specific tooling directories (e.g. `.cursor/`, `.gemini/`, `.claude/`)
- `{{SDD_DIR}}/settings/` content should NOT be documented in steering files (settings are metadata, not project knowledge)
- Light references to `{{SDD_DIR}}/specs/` and `{{SDD_DIR}}/steering/` are acceptable; avoid other `.sdd/` directories
