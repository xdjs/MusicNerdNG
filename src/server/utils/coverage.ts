import { db } from '@/server/db/drizzle';
import { coverageReports } from '@/server/db/schema';
import { eq, desc, and } from 'drizzle-orm';

export interface CoverageData {
  total: {
    lines: { total: number; covered: number; pct: number };
    functions: { total: number; covered: number; pct: number };
    statements: { total: number; covered: number; pct: number };
    branches: { total: number; covered: number; pct: number };
  }
}

export interface CoverageMetadata {
  repository: string;
  branch: string;
  commit: string;
  workflow_run_id?: string;
}

export async function storeCoverageReport(
  coverageData: CoverageData,
  metadata: CoverageMetadata
) {
  try {
    const total = coverageData.total;
    
    const result = await db.insert(coverageReports).values({
      repository: metadata.repository,
      branch: metadata.branch,
      commit_sha: metadata.commit,
      workflow_run_id: metadata.workflow_run_id,
      coverage_data: coverageData,
      total_coverage: total.lines.pct.toString(),
      lines_covered: total.lines.covered,
      lines_total: total.lines.total,
      functions_covered: total.functions.covered,
      functions_total: total.functions.total,
      branches_covered: total.branches.covered,
      branches_total: total.branches.total,
      statements_covered: total.statements.covered,
      statements_total: total.statements.total,
    }).returning();

    return result[0];
  } catch (error) {
    console.error('Error storing coverage report:', error);
    throw error;
  }
}

export async function getCoverageHistory(
  repository: string,
  branch?: string,
  limit = 50
) {
  try {
    const whereCondition = branch 
      ? and(eq(coverageReports.repository, repository), eq(coverageReports.branch, branch))
      : eq(coverageReports.repository, repository);

    const reports = await db
      .select()
      .from(coverageReports)
      .where(whereCondition)
      .orderBy(desc(coverageReports.created_at))
      .limit(limit);

    return reports;
  } catch (error) {
    console.error('Error fetching coverage history:', error);
    throw error;
  }
}

export async function getLatestCoverage(repository: string, branch: string) {
  try {
    const report = await db
      .select()
      .from(coverageReports)
      .where(
        and(
          eq(coverageReports.repository, repository),
          eq(coverageReports.branch, branch)
        )
      )
      .orderBy(desc(coverageReports.created_at))
      .limit(1);

    return report[0] || null;
  } catch (error) {
    console.error('Error fetching latest coverage:', error);
    throw error;
  }
}

export async function getCoverageTrends(repository: string, branch: string, days = 30) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const reports = await db
      .select({
        date: coverageReports.created_at,
        total_coverage: coverageReports.total_coverage,
        commit_sha: coverageReports.commit_sha,
      })
      .from(coverageReports)
      .where(
        and(
          eq(coverageReports.repository, repository),
          eq(coverageReports.branch, branch)
        )
      )
      .orderBy(desc(coverageReports.created_at));

    return reports;
  } catch (error) {
    console.error('Error fetching coverage trends:', error);
    throw error;
  }
} 