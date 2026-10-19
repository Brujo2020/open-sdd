# Requirements Document

## Introduction

This specification covers the restoration of the `open-sdd` product from git history and its
alignment with the published reference architecture ("Orquestación SDD-First Multiagente para
Desarrollo Enterprise", rev. 3, September 2026). The repository's HEAD had deleted the entire
product, leaving manifests that pointed at files which no longer existed.

Requirements are written in EARS syntax. Each acceptance criterion names its own trigger
condition. The paper's own limit applies: EARS disciplines the statement of a requirement, not
its correctness.

## Requirements

### Requirement 1: Restore and keep the product installable

**Objective:** As a maintainer, I want the repository to install and build from a clean clone, so that the documentation and the running system agree.

#### Acceptance Criteria

- When a user runs `npm install` at the repository root, the [system] shall not spawn more than one nested dependency install.
- If the workspace directory is absent, then the [system] shall skip the workspace install and exit successfully with an explanatory message.
- When the package is packed for publication, the [package] shall include the compiled CLI and the agent templates.
- The [installer] shall refuse to claim success when the build produced no CLI artifact.

### Requirement 2: Resolve the gate chain from catalog, profile and signals

**Objective:** As an auditor, I want the executable chain resolved rather than hardcoded, so that the executor cannot run a control the profile did not enable nor silently omit one it did.

#### Acceptance Criteria

- When the profile is the recommended one, the [resolver] shall return the constant core of seven controls and no activable control.
- When the profile is team, the [resolver] shall return the core plus the two profile-mandated opt-in controls.
- When the profile is regulated, the [resolver] shall return the core plus five profile-mandated opt-in controls.
- Where a repository signal is detected, the [resolver] shall activate the opt-in control the signal justifies.
- When the resolver activates an opt-in control, the [resolver] shall cite the signal that justified that activation.
- If a control is declared and not implemented, then the [resolver] shall count it in the chain and report it as not implemented.
- If a control runs without inspecting anything, then the [resolver] shall report it as vacuous instead of executable.

### Requirement 3: Compute the crosswalk residue by subtraction

**Objective:** As a reader, I want the uncovered controls computed rather than curated, so that the documentation cannot claim a control the running chain does not implement.

#### Acceptance Criteria

- When the crosswalk is built, the [catalog] shall derive it from the declared chain and not from a transcribed table.
- When the residue is computed, the [catalog] shall return exactly the logical controls that no executable check imposes.
- The [catalog] shall report how many logical controls are covered out of the full taxonomy.

### Requirement 4: Fail closed, honestly

**Objective:** As a security reviewer, I want gate outcomes to distinguish an absent instrument from a clean scan, so that a missing sensor is never read as an approved verification.

#### Acceptance Criteria

- If a sensor is unavailable under the flexible regime, then the [evaluator] shall self-authorize the process gate and require a relaxation receipt.
- If a sensor is unavailable under the strict regime, then the [evaluator] shall fail the gate.
- If the control belongs to the hard subset, then the [evaluator] shall fail the gate in every regime.
- When a scanner ran and found a violation, the [evaluator] shall fail the gate.
- If a scanner ran and found a violation, then the [evaluator] shall not self-authorize that gate.
- If a control does not inspect, then the [evaluator] shall not let it pass as a control.

### Requirement 5: Declare enforcement per host and never promise level A as the floor

**Objective:** As an enterprise buyer, I want guarantees scoped to boundaries the organization owns, so that a vendor cannot withdraw a control the programme promised.

#### Acceptance Criteria

- When a floor is resolved for any host tool, the [resolver] shall include the commit and merge boundaries.
- While no behavioural sentinel has verified write-time blocking, the [resolver] shall report level A as a ceiling and not as a guarantee.
- If a hook terminates with a hook-failure exit code, then the [sentinel] shall report fail-open rather than blocked.
- If a claimed floor includes a borrowed level, then the [guard] shall raise an error.

### Requirement 6: Record every relaxation

**Objective:** As an auditor, I want exceptions to be events, so that the difference between an organization that never relaxed a control and one that relaxed it daily is observable.

#### Acceptance Criteria

- When a relaxation is recorded, the [ledger] shall require an actor, a reason and the hash the relaxation applies to.
- If a relaxation is observed without a receipt, then the [assessment] shall report the invariant as violated.
- When the override rate for a gate is sustained at or above the review threshold, the [calibration] shall move that gate into design review.

### Requirement 7: Make multi-agent work transactional

**Objective:** As an engineer, I want intermediate states to be unobservable, so that a failed wave requires no emergency procedure.

#### Acceptance Criteria

- When any task in a wave fails its gates, the [scheduler] shall discard every worktree of that wave including those that passed.
- If a wave is discarded, then the [scheduler] shall report that no intermediate state was observable in the repository.
- When a task touches a file outside its declared scope, the [scope check] shall report a violation.
- While two identities hold live claims on the same file, the [claim registry] shall report an overlap.

### Requirement 8: Resist memory poisoning by provenance

**Objective:** As a platform owner, I want quarantine and provenance on the promotion path, so that a poisoned lesson cannot re-enter every future context.

#### Acceptance Criteria

- If an item is still in the capture stage, then the [memory] shall refuse to inject it.
- If a distilled note lacks a complete provenance signature, then the [memory] shall refuse promotion.
- When the curator scans a note, the [scanner] shall detect instruction-override and self-grant patterns.
- If a note fails the same security screening as outbound prompts, then the [memory] shall refuse promotion.
- When an item is not reconfirmed across two review cycles, the [decay] shall degrade it to inactive before retirement.

### Requirement 9: Never let a skill widen reachable MCP servers

**Objective:** As a security owner, I want privilege widening to be a recorded human decision, so that installing a capability cannot escalate access as a side effect.

#### Acceptance Criteria

- If a skill declares an MCP server without a registered concession, then the [checker] shall reject it and list it as undeclared.
- If a concession has no named actor or no reason, then the [checker] shall not count it as a concession.
- When a generated skill candidate declares MCP servers, the [factory] shall refuse to mount it.
- If the evaluating model family equals the generating family, then the [factory] shall refuse to mount the candidate.

### Requirement 10: Register documentation claims against executable verifiers

**Objective:** As a technical evaluator, I want every published claim bound to a command, so that prose cannot drift from the repository in silence.

#### Acceptance Criteria

- When a claim is evaluated and its verifier exits non-zero while the text claims it passes, the [registry] shall mark it broken.
- When a claim declares a gap and the verifier confirms the gap, the [registry] shall mark it as not implemented rather than broken.
- If a verifier passes where the text declared an absence, then the [registry] shall mark the text as outdated.
- The [registry] shall report that only the broken state justifies halting a publication.
