# Testing Standards

[Purpose: guide what to test, where tests live, and how to structure them]

## Philosophy
- Test behavior, not implementation
- Prefer fast, reliable tests; minimize brittle mocks
- Cover critical paths deeply; breadth over 100% pursuit

## Organization
Options:
- Co-located: `component.tsx` + `component.test.tsx`
- Separate: `/src/...` and `/tests/...`
Pick one as default; allow exceptions with rationale.

Naming:
- Files: `*.test.*` or `*.spec.*`
- Suites: what is under test; Cases: expected behavior

## Test Types
- Unit: single unit, mocked dependencies, very fast
- Integration: multiple units together, mock externals only
- E2E: full flows, minimal mocks, only for critical journeys

## Structure (AAA)
```typescript
it('does X when Y', () => {
  // Arrange
  const input = setup();
  // Act
  const result = act(input);
  // Assert
  expect(result).toEqual(expected);
});
```

## Mocking & Data
- Mock externals (API/DB); never mock the system under test
- Use factories/fixtures; reset state between tests
- Keep test data minimal and intention-revealing

## Coverage
- Target: [% overall]; higher for critical domains
- Enforce thresholds in CI; exceptions require review rationale

---

## Enterprise Autonomous Quality Engineering (Agentic QE)
For enterprise systems requiring continuous, autonomous validation beyond static scripts:
- **Framework**: Agentic QE (`https://agentic-qe.dev`) based on the PACTS methodology:
  - **Proactive**: Predict regression risks and invariant violations before commit.
  - **Autonomous**: Auto-generate property-based, metamorphic, and characterization test suites for legacy/brownfield boundaries.
  - **Collaborative**: Autonomous QE agents work alongside developer subagents (`sdd-review`) under human oversight.
  - **Targeted**: Constrain test execution and fuzzing strictly to task boundaries (`_Boundary:_`).
  - **Structured**: Deterministic quality telemetry, coverage gap analysis, and auditable proof matrices for `/sdd-audit`.
- **Integration**: Agentic QE Fleet (`npm i -g agentic-qe` or MCP server `aqe init --auto`).

---
_Focus on patterns and decisions. Tool-specific config lives elsewhere._
