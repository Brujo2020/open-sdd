/**
 * Markdown summary of a gate run for a CI job page (REQ-W2-010).
 *
 * GitHub renders whatever a step appends to `$GITHUB_STEP_SUMMARY` on the run page; any other CI can
 * pass an explicit path. Only the run's own findings are rendered: nothing is inferred or re-scored.
 */

import type { GateRunReport } from './gateRunner.js';

const ICON: Record<string, string> = { pass: '✅', fail: '❌', 'self-authorized': '⚠️', advisory: 'ℹ️' };

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export const renderGateSummary = (
  report: GateRunReport,
  meta: { profile: string; strict: boolean; mode: string; names: Record<string, string> },
): string => {
  const lines = [
    `### open-sdd gates — ${report.passed ? '✅ the chain passes' : '❌ the chain does NOT pass'}`,
    '',
    `Profile \`${meta.profile}\` · regime ${meta.strict ? 'strict' : 'flexible'} · ${meta.mode}`,
    '',
    '| Gate | Name | Outcome | Detail |',
    '|---|---|---|---|',
    ...report.findings.map((finding) => {
      const detail = finding.detail.length > 160 ? `${finding.detail.slice(0, 160)}…` : finding.detail;
      return `| ${finding.gateId} | ${cell(meta.names[finding.gateId] ?? '')} | ${ICON[finding.outcome] ?? ''} ${finding.outcome} | ${cell(detail)} |`;
    }),
  ];
  if (report.unavailable.length > 0) {
    lines.push('', `Self-authorized because the sensor is unavailable: ${report.unavailable.join(', ')} (not evidence).`);
  }
  return `${lines.join('\n')}\n`;
};
