import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';
    
    // Check if coverage files exist
    const coverageDir = path.join(process.cwd(), 'coverage');
    
    try {
      await fs.access(coverageDir);
    } catch {
      return NextResponse.json({ error: 'Coverage data not found' }, { status: 404 });
    }

    switch (format) {
      case 'json':
        const summaryPath = path.join(coverageDir, 'coverage-summary.json');
        try {
          const summaryContent = await fs.readFile(summaryPath, 'utf8');
          const summary = JSON.parse(summaryContent);
          return NextResponse.json(summary);
        } catch {
          return NextResponse.json({ error: 'Coverage summary not found' }, { status: 404 });
        }

      case 'html':
        const htmlPath = path.join(coverageDir, 'lcov-report', 'index.html');
        try {
          const htmlContent = await fs.readFile(htmlPath, 'utf8');
          return new NextResponse(htmlContent, {
            headers: { 'Content-Type': 'text/html' }
          });
        } catch {
          return NextResponse.json({ error: 'HTML coverage report not found' }, { status: 404 });
        }

      case 'lcov':
        const lcovPath = path.join(coverageDir, 'lcov.info');
        try {
          const lcovContent = await fs.readFile(lcovPath, 'utf8');
          return new NextResponse(lcovContent, {
            headers: { 'Content-Type': 'text/plain' }
          });
        } catch {
          return NextResponse.json({ error: 'LCOV report not found' }, { status: 404 });
        }

      default:
        return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
    }
  } catch (error) {
    console.error('Coverage API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { coverage, metadata } = body;
    
    // Import the coverage service
    const { storeCoverageReport } = await import('@/server/utils/coverage');
    
    // Store coverage data in database
    const result = await storeCoverageReport(coverage, metadata);
    
    // Process all webhook notifications
    const webhookPromises = [];
    
    // Send to Slack if configured
    if (process.env.SLACK_WEBHOOK_URL) {
      const totalCoverage = coverage?.total?.lines?.pct || 0;
      const emoji = totalCoverage >= 80 ? '✅' : totalCoverage >= 60 ? '⚠️' : '❌';
      
      webhookPromises.push(
        fetch(process.env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `${emoji} Coverage Report for ${metadata.repository}`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*${metadata.repository}* (${metadata.branch})\n` +
                        `Lines: ${totalCoverage}%\n` +
                        `Functions: ${coverage?.total?.functions?.pct || 0}%\n` +
                        `Branches: ${coverage?.total?.branches?.pct || 0}%\n` +
                        `Commit: \`${metadata.commit?.substring(0, 7)}\``
                }
              }
            ]
          })
        })
      );
    }

    // Send to Discord if configured  
    if (process.env.DISCORD_COVERAGE_URL) {
      const totalCoverage = coverage?.total?.lines?.pct || 0;
      const color = totalCoverage >= 80 ? 0x00ff00 : totalCoverage >= 60 ? 0xffff00 : 0xff0000;
      
      webhookPromises.push(
        fetch(process.env.DISCORD_COVERAGE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: `Coverage Report: ${metadata.repository}`,
              description: `Branch: ${metadata.branch}\nCommit: ${metadata.commit?.substring(0, 7)}`,
              color,
              fields: [
                { name: 'Lines', value: `${totalCoverage}%`, inline: true },
                { name: 'Functions', value: `${coverage?.total?.functions?.pct || 0}%`, inline: true },
                { name: 'Branches', value: `${coverage?.total?.branches?.pct || 0}%`, inline: true }
              ],
              timestamp: new Date().toISOString()
            }]
          })
        })
      );
    }
    
    // Send to external webhook if configured
    if (process.env.EXTERNAL_COVERAGE_WEBHOOK) {
      webhookPromises.push(
        fetch(process.env.EXTERNAL_COVERAGE_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repository: metadata.repository,
            branch: metadata.branch,
            commit: metadata.commit,
            coverage,
            workflow_run_id: metadata.workflow_run_id,
            timestamp: result.created_at
          })
        })
      );
    }

    // Wait for all webhooks to complete (don't fail if some webhooks fail)
    await Promise.allSettled(webhookPromises);

    return NextResponse.json({ 
      success: true, 
      id: result.id,
      timestamp: result.created_at,
      webhooks_sent: webhookPromises.length
    });
  } catch (error) {
    console.error('Coverage POST error:', error);
    return NextResponse.json({ error: 'Failed to process coverage data' }, { status: 500 });
  }
} 