---
name: sdd-characterize
description: Characterization tests — freeze the CURRENT behaviour of legacy code before changing it
---

# Characterization tests (Golden Characterization Locking)

<instructions>
## Why this flow exists
You cannot prove a change on legacy code kept everything else intact if nothing describes what the code does today.
Characterization tests (Feathers) pin the CURRENT behaviour — even when it looks like a bug — so every later delta,
refactor or fix has a regression oracle. Nothing is fixed here. (SteelForge `/sdd-characterize`.)

## Steps
1. List the observable behaviour of the area (inputs → outputs, errors, effects on files, network, database,
   events, logs someone reads) with `file:line`. Run `open-sdd brownfield contracts <feature>` to see which tests
   already protect it; characterize only the gaps.
2. Show a table `behaviour · evidence · already covered?` and let the user decide what to freeze.
3. Write the tests with the project's framework, asserting what the code DOES today (real values obtained by running
   it, not what it "should" return). Fix non-determinism (time, randomness, network). Mark them as characterization.
4. Run them WITHOUT touching production code: they must pass. If one fails, the test is wrong, not the code.
5. Report the command and output as evidence, and continue with `/sdd-refactor`, `/sdd-bugfix` or `open-sdd delta init`.
</instructions>
