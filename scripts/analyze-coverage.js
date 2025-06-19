#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Analyze coverage data and generate detailed Discord webhook payload
 */
function analyzeCoverage() {
  const coverageSummaryPath = path.join(process.cwd(), 'coverage', 'coverage-summary.json');
  
  if (!fs.existsSync(coverageSummaryPath)) {
    console.error('Coverage summary file not found!');
    process.exit(1);
  }

  const coverageData = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
  
  // Extract overall totals
  const total = coverageData.total;
  const totalLines = total.lines.pct;
  const totalFunctions = total.functions.pct;
  const totalBranches = total.branches.pct;
  const totalStatements = total.statements.pct;
  
  // Analyze individual files
  const filesNeedingCoverage = [];
  const filesWithZeroCoverage = [];
  const wellCoveredFiles = [];
  
  Object.entries(coverageData).forEach(([filePath, fileData]) => {
    if (filePath === 'total') return;
    
    // Skip test files and configuration files
    if (filePath.includes('.test.') || 
        filePath.includes('.spec.') || 
        filePath.includes('jest.') ||
        filePath.includes('vitest.') ||
        filePath.includes('.config.') ||
        filePath.includes('__tests__') ||
        filePath.includes('__mocks__')) {
      return;
    }
    
    const linesCoverage = fileData.lines.pct;
    const functionsCoverage = fileData.functions.pct;
    const branchesCoverage = fileData.branches.pct;
    
    // Categorize files
    if (linesCoverage === 0 && functionsCoverage === 0) {
      filesWithZeroCoverage.push({
        path: filePath,
        lines: linesCoverage,
        functions: functionsCoverage,
        branches: branchesCoverage
      });
    } else if (linesCoverage > 0 && linesCoverage < 70) {
      filesNeedingCoverage.push({
        path: filePath,
        lines: linesCoverage,
        functions: functionsCoverage,
        branches: branchesCoverage
      });
    } else if (linesCoverage >= 80) {
      wellCoveredFiles.push({
        path: filePath,
        lines: linesCoverage,
        functions: functionsCoverage,
        branches: branchesCoverage
      });
    }
  });

  // Sort arrays by coverage percentage (worst first)
  filesNeedingCoverage.sort((a, b) => a.lines - b.lines);
  filesWithZeroCoverage.sort((a, b) => a.path.localeCompare(b.path));
  wellCoveredFiles.sort((a, b) => b.lines - a.lines);

  // Determine overall color
  const color = totalLines >= 80 ? 0x00ff00 : totalLines >= 60 ? 0xffff00 : 0xff0000;
  
  // Format file paths for display
  const formatFilePath = (filePath) => {
    // Normalize path separators and remove absolute path prefixes
    let cleanPath = filePath.replace(/\\/g, '/');
    
    // Remove any absolute path prefix (Windows or Unix)
    cleanPath = cleanPath.replace(/^.*[\\\/]MusicNerdNG[\\\/]/, '');
    
    // Remove src/ prefix and file extensions
    cleanPath = cleanPath.replace(/^src\//, '').replace(/\.(ts|tsx|js|jsx)$/, '');
    
    return cleanPath;
  };

  // Build Discord embed fields
  const fields = [
    { name: 'Lines', value: `${totalLines}%`, inline: true },
    { name: 'Functions', value: `${totalFunctions}%`, inline: true },
    { name: 'Branches', value: `${totalBranches}%`, inline: true }
  ];

  // Add zero coverage files (most critical)
  if (filesWithZeroCoverage.length > 0) {
    const zeroFiles = filesWithZeroCoverage
      .slice(0, 5) // Limit to 5 files to avoid Discord limits
      .map(file => `• ${formatFilePath(file.path)}`)
      .join('\n');
    
    fields.push({
      name: `🚨 Files with Zero Coverage (${filesWithZeroCoverage.length})`,
      value: zeroFiles + (filesWithZeroCoverage.length > 5 ? '\n• ...' : ''),
      inline: false
    });
  }

  // Add files needing more coverage
  if (filesNeedingCoverage.length > 0) {
    const needsCoverageFiles = filesNeedingCoverage
      .slice(0, 5) // Limit to 5 files
      .map(file => `• ${formatFilePath(file.path)} (${file.lines}%)`)
      .join('\n');
    
    fields.push({
      name: `⚠️ Files Needing More Coverage (${filesNeedingCoverage.length})`,
      value: needsCoverageFiles + (filesNeedingCoverage.length > 5 ? '\n• ...' : ''),
      inline: false
    });
  }

  // Add well covered files (positive reinforcement)
  if (wellCoveredFiles.length > 0) {
    const wellCovered = wellCoveredFiles
      .slice(0, 3) // Show top 3 well-covered files
      .map(file => `• ${formatFilePath(file.path)} (${file.lines}%)`)
      .join('\n');
    
    fields.push({
      name: `✅ Well Covered Files (${wellCoveredFiles.length})`,
      value: wellCovered + (wellCoveredFiles.length > 3 ? '\n• ...' : ''),
      inline: false
    });
  }

  // Generate summary statistics
  const totalFiles = Object.keys(coverageData).length - 1; // Exclude 'total' key
  const summary = [
    `📊 **Coverage Summary**`,
    `• Total Files: ${totalFiles}`,
    `• Zero Coverage: ${filesWithZeroCoverage.length}`,
    `• Need Improvement: ${filesNeedingCoverage.length}`,
    `• Well Covered: ${wellCoveredFiles.length}`
  ].join('\n');

  // Build the complete Discord webhook payload
  const webhookPayload = {
    embeds: [{
      title: `Coverage Report: ${process.env.GITHUB_REPOSITORY || 'Repository'}`,
      description: `Branch: ${process.env.GITHUB_REF_NAME || 'unknown'}\nCommit: ${(process.env.GITHUB_SHA || '').substring(0, 7)}\n\n${summary}`,
      color,
      fields,
      timestamp: new Date().toISOString(),
      footer: {
        text: `Coverage Threshold: 70% • Target: 80%+`
      }
    }]
  };

  // Output the webhook payload as JSON
  console.log(JSON.stringify(webhookPayload, null, 2));
  
  // Also output some useful info for CI logs
  console.error(`Coverage Analysis Complete:`);
  console.error(`- Overall Coverage: ${totalLines}%`);
  console.error(`- Files with Zero Coverage: ${filesWithZeroCoverage.length}`);
  console.error(`- Files Needing Improvement: ${filesNeedingCoverage.length}`);
  console.error(`- Well Covered Files: ${wellCoveredFiles.length}`);
}

// Run the analysis
if (require.main === module) {
  analyzeCoverage();
}

module.exports = { analyzeCoverage }; 