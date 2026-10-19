import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

/**
 * AI-Guided spec refinement (simulated)
 * Analyzes spec gaps and suggests improvements
 */

export interface SpecIssue {
  type: 'gap' | 'vague' | 'risk' | 'opportunity';
  severity: 'low' | 'medium' | 'high';
  line: number;
  description: string;
  suggestion: string;
  confidence: number;
}

export interface RefinementReport {
  feature: string;
  totalIssues: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  issues: SpecIssue[];
  estimatedTimeImpact: number;
}

/**
 * Analyze spec for gaps and improvements
 */
export async function analyzeSpecForGaps(
  requirementsContent: string,
  designContent: string,
  feature: string
): Promise<RefinementReport> {
  const issues: SpecIssue[] = [];
  const fullContent = `${requirementsContent}\n${designContent}`;

  // Check for vague language
  const vaguePatterns = [
    { pattern: /should\s+handle|may\s+need|could\s+support/gi, text: 'Vague requirement' },
    { pattern: /etc\.|and\s+more|and\s+so\s+on/gi, text: 'Incomplete list' },
    { pattern: /probably|hopefully|maybe|possibly/gi, text: 'Uncertain language' }
  ];

  for (const { pattern, text } of vaguePatterns) {
    const matches = fullContent.matchAll(pattern);
    for (const match of matches) {
      issues.push({
        type: 'vague',
        severity: 'medium',
        line: fullContent.substring(0, match.index!).split('\n').length,
        description: `${text}: "${match[0]}"`,
        suggestion: 'Specify exact behavior instead of vague language',
        confidence: 0.8
      });
    }
  }

  // Check for missing sections
  const sections = [
    { name: 'Error Handling', pattern: /error|exception|fail/i },
    { name: 'Security', pattern: /auth|secure|password|token|encryption/i },
    { name: 'Performance', pattern: /fast|slow|speed|latency|cache/i },
    { name: 'Concurrency', pattern: /concurrent|race|thread|async|parallel/i },
    { name: 'Database', pattern: /database|store|persist|query|sql/i }
  ];

  const coverage = sections.map(s => ({
    name: s.name,
    found: s.pattern.test(fullContent)
  }));

  coverage.filter(c => !c.found).forEach((missing, idx) => {
    issues.push({
      type: 'gap',
      severity: 'high',
      line: 1,
      description: `Missing section: ${missing.name} requirements not defined`,
      suggestion: `Add "## ${missing.name}" section with specific requirements`,
      confidence: 0.9
    });
  });

  // Risk detection
  const risks = [
    { pattern: /delete|remove|cascade/i, risk: 'Data loss potential without cascade strategy' },
    { pattern: /admin|permission|role/i, risk: 'Access control model needs specification' },
    { pattern: /external|third[- ]party|api/i, risk: 'External dependency risks not documented' }
  ];

  for (const { pattern, risk } of risks) {
    if (pattern.test(fullContent)) {
      issues.push({
        type: 'risk',
        severity: 'high',
        line: 1,
        description: risk,
        suggestion: 'Document mitigation strategy and fallback behavior',
        confidence: 0.85
      });
    }
  }

  // Opportunities
  const opportunities = [
    { pattern: /user|login|auth/, opp: 'Add OAuth2 / SSO support' },
    { pattern: /data|store|database/, opp: 'Consider caching strategy (Redis/Memcached)' },
    { pattern: /api|endpoint|rest/, opp: 'Add rate limiting and API versioning' },
    { pattern: /search|filter|query/, opp: 'Add full-text search capabilities' }
  ];

  for (const { pattern, opp } of opportunities) {
    if (pattern.test(fullContent)) {
      issues.push({
        type: 'opportunity',
        severity: 'low',
        line: 1,
        description: opp,
        suggestion: 'Consider adding to spec for better architecture',
        confidence: 0.7
      });
    }
  }

  // Aggregate by type and severity
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  issues.forEach(issue => {
    byType[issue.type] = (byType[issue.type] || 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
  });

  // Estimate time impact
  const estimatedTimeImpact = Math.ceil(
    (issues.filter(i => i.severity === 'high').length * 4) +
    (issues.filter(i => i.severity === 'medium').length * 2)
  );

  return {
    feature,
    totalIssues: issues.length,
    byType,
    bySeverity,
    issues: issues.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    }),
    estimatedTimeImpact
  };
}

/**
 * Apply suggested improvements to spec
 */
export async function applyRefinements(
  requirementsPath: string,
  suggestions: SpecIssue[]
): Promise<number> {
  let content = fs.readFileSync(requirementsPath, 'utf-8');
  let appliedCount = 0;

  // Add missing sections
  const gapIssues = suggestions.filter(s => s.type === 'gap');
  if (gapIssues.length > 0) {
    const sections = gapIssues.map(s => {
      const match = s.description.match(/Missing section: (.+) requirements/);
      return match ? match[1] : '';
    }).filter(Boolean);

    sections.forEach(section => {
      if (!content.includes(`## ${section}`)) {
        content += `\n\n## ${section}\n\n- Add ${section.toLowerCase()} requirements here\n`;
        appliedCount++;
      }
    });
  }

  // Add security note if missing
  if (suggestions.some(s => s.type === 'risk')) {
    if (!content.includes('## Security Considerations')) {
      content += '\n\n## Security Considerations\n\n- Review access control model\n';
      appliedCount++;
    }
  }

  fs.writeFileSync(requirementsPath, content, 'utf-8');
  return appliedCount;
}

/**
 * Render refinement report
 */
export function renderRefinementReport(report: RefinementReport): string[] {
  const lines: string[] = [];

  lines.push(chalk.cyan.bold(`\n🔍 Spec Analysis: ${report.feature}`));
  lines.push(chalk.gray(`Total issues found: ${report.totalIssues}`));
  lines.push('');

  // By severity
  lines.push(chalk.yellow.bold('By Severity:'));
  lines.push(chalk.red(`  🔴 Critical: ${report.bySeverity['high'] || 0}`));
  lines.push(chalk.yellow(`  🟡 Medium: ${report.bySeverity['medium'] || 0}`));
  lines.push(chalk.green(`  🟢 Low: ${report.bySeverity['low'] || 0}`));
  lines.push('');

  // By type
  lines.push(chalk.yellow.bold('By Type:'));
  lines.push(chalk.red(`  Gap: ${report.byType['gap'] || 0} (missing sections)`));
  lines.push(chalk.yellow(`  Vague: ${report.byType['vague'] || 0} (unclear language)`));
  lines.push(chalk.orange(`  Risk: ${report.byType['risk'] || 0} (potential issues)`));
  lines.push(chalk.green(`  Opportunity: ${report.byType['opportunity'] || 0} (enhancements)`));
  lines.push('');

  // Time impact
  if (report.estimatedTimeImpact > 0) {
    lines.push(chalk.cyan(`⏱️  Estimated impact: +${report.estimatedTimeImpact}h if addressed`));
    lines.push('');
  }

  // Top issues
  if (report.issues.length > 0) {
    lines.push(chalk.yellow.bold('Top Issues:'));
    report.issues.slice(0, 5).forEach((issue, idx) => {
      const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
      lines.push(chalk.white(`  ${idx + 1}. ${icon} ${issue.description}`));
      lines.push(chalk.gray(`     💡 ${issue.suggestion}`));
    });
    if (report.issues.length > 5) {
      lines.push(chalk.gray(`  ... and ${report.issues.length - 5} more`));
    }
  }

  lines.push('');

  return lines;
}

/**
 * Render auto-apply suggestions
 */
export function renderAutoApplySuggestions(applied: number, total: number): string[] {
  const lines: string[] = [];

  lines.push(chalk.green.bold(`\n✅ Auto-Applied Suggestions`));
  lines.push(chalk.white(`  ${applied}/${total} improvements applied to spec`));
  lines.push(chalk.gray(`  Run /sdd-spec-refine ${chalk.reset('feature')} again for updated analysis\n`));

  return lines;
}
