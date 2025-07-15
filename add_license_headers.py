#!/usr/bin/env python3
"""
Script to add license headers to source code files.
Copyright (c) 2025 MusicNerdNG
Licensed under the MIT License.
"""

import os
import re
import argparse
from pathlib import Path
from typing import Dict, List, Tuple, Optional

# License header templates for different file types
LICENSE_HEADERS = {
    'js': '''/**
 * Copyright (c) 2025 MusicNerdNG
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 */

''',
    'css': '''/*
 * Copyright (c) 2025 MusicNerdNG
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 */

''',
    'html': '''<!--
Copyright (c) 2025 MusicNerdNG
Licensed under the MIT License.
See LICENSE file in the project root for full license information.
-->

''',
    'sql': '''--
-- Copyright (c) 2025 MusicNerdNG
-- Licensed under the MIT License.
-- See LICENSE file in the project root for full license information.
--

''',
    'py': '''"""
Copyright (c) 2025 MusicNerdNG
Licensed under the MIT License.
See LICENSE file in the project root for full license information.
"""

''',
    'sh': '''#!/bin/bash
#
# Copyright (c) 2025 MusicNerdNG
# Licensed under the MIT License.
# See LICENSE file in the project root for full license information.
#

'''
}

# File extensions mapped to license header types
FILE_EXTENSIONS = {
    '.js': 'js',
    '.jsx': 'js',
    '.ts': 'js',
    '.tsx': 'js',
    '.mjs': 'js',
    '.css': 'css',
    '.scss': 'css',
    '.sass': 'css',
    '.html': 'html',
    '.htm': 'html',
    '.sql': 'sql',
    '.py': 'py',
    '.sh': 'sh',
    '.bash': 'sh',
    '.zsh': 'sh'
}

# Directories to skip
SKIP_DIRS = {
    'node_modules',
    '.git',
    '.next',
    'dist',
    'build',
    '.cache',
    'coverage',
    '__pycache__',
    '.pytest_cache',
    '.vscode',
    '.idea',
    'drizzle'  # Database migrations shouldn't have license headers
}

# Files to skip
SKIP_FILES = {
    'package-lock.json',
    'bun.lockb',
    'yarn.lock',
    '.env',
    '.env.local',
    '.env.example',
    '.gitignore',
    '.eslintrc.json',
    'tsconfig.json',
    'next.config.mjs',
    'tailwind.config.ts',
    'postcss.config.mjs',
    'jest.config.ts',
    'jest.setup.ts',
    'vitest.config.ts',
    'drizzle.config.ts',
    'components.json'
}

def has_license_header(content: str, file_type: str) -> bool:
    """Check if the file already has a license header."""
    # Look for copyright notice in the first 20 lines
    lines = content.split('\n')[:20]
    content_start = '\n'.join(lines).lower()
    
    # Check for various forms of copyright notice
    copyright_patterns = [
        r'copyright.*musicnerdng',
        r'licensed under.*mit',
        r'see license file',
        r'mit license'
    ]
    
    for pattern in copyright_patterns:
        if re.search(pattern, content_start, re.IGNORECASE):
            return True
    
    return False

def should_skip_file(file_path: Path) -> bool:
    """Check if a file should be skipped."""
    # Skip if filename is in skip list
    if file_path.name in SKIP_FILES:
        return True
    
    # Skip if any parent directory is in skip list
    for parent in file_path.parents:
        if parent.name in SKIP_DIRS:
            return True
    
    # Skip if file extension is not supported
    if file_path.suffix not in FILE_EXTENSIONS:
        return True
    
    # Skip test files in some cases (optional)
    if '.test.' in file_path.name or '.spec.' in file_path.name:
        return True
    
    return False

def add_license_header(file_path: Path, dry_run: bool = False) -> Tuple[bool, str]:
    """Add license header to a file if it doesn't have one."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except UnicodeDecodeError:
        return False, f"Skipped (binary file): {file_path}"
    except Exception as e:
        return False, f"Error reading {file_path}: {e}"
    
    # Determine file type
    file_type = FILE_EXTENSIONS.get(file_path.suffix, 'js')
    
    # Check if already has license header
    if has_license_header(content, file_type):
        return False, f"Already has license: {file_path}"
    
    # Get appropriate license header
    header = LICENSE_HEADERS[file_type]
    
    # Handle shebang lines for shell scripts
    if file_type == 'sh' and content.startswith('#!'):
        # Extract shebang line
        lines = content.split('\n')
        shebang = lines[0] + '\n'
        rest_content = '\n'.join(lines[1:])
        
        # Create header without shebang (it's already in the template)
        header_without_shebang = header.split('\n', 1)[1]  # Remove first line
        new_content = shebang + header_without_shebang + rest_content
    else:
        new_content = header + content
    
    if dry_run:
        return True, f"Would add license to: {file_path}"
    
    # Write the file with license header
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        return True, f"Added license to: {file_path}"
    except Exception as e:
        return False, f"Error writing {file_path}: {e}"

def find_source_files(root_dir: Path) -> List[Path]:
    """Find all source code files in the directory."""
    source_files = []
    
    for file_path in root_dir.rglob('*'):
        if file_path.is_file() and not should_skip_file(file_path):
            source_files.append(file_path)
    
    return sorted(source_files)

def main():
    parser = argparse.ArgumentParser(description='Add license headers to source code files')
    parser.add_argument('--dry-run', action='store_true', 
                       help='Show what would be changed without making changes')
    parser.add_argument('--directory', '-d', type=str, default='.',
                       help='Directory to scan (default: current directory)')
    parser.add_argument('--include-tests', action='store_true',
                       help='Include test files (.test.* and .spec.*)')
    parser.add_argument('--verbose', '-v', action='store_true',
                       help='Show verbose output')
    
    args = parser.parse_args()
    
    # Modify skip behavior based on arguments
    if args.include_tests:
        # Don't skip test files
        pass
    
    root_dir = Path(args.directory).resolve()
    
    if not root_dir.exists():
        print(f"Error: Directory {root_dir} does not exist")
        return 1
    
    print(f"Scanning directory: {root_dir}")
    
    # Find all source files
    source_files = find_source_files(root_dir)
    
    if not source_files:
        print("No source files found.")
        return 0
    
    print(f"Found {len(source_files)} source files")
    
    if args.dry_run:
        print("\n=== DRY RUN MODE ===")
    
    # Process each file
    modified_count = 0
    skipped_count = 0
    error_count = 0
    
    for file_path in source_files:
        try:
            # Make path relative to root for cleaner output
            rel_path = file_path.relative_to(root_dir)
            
            changed, message = add_license_header(file_path, args.dry_run)
            
            if changed:
                modified_count += 1
                print(f"✓ {rel_path}")
            else:
                skipped_count += 1
                if args.verbose:
                    print(f"- {rel_path} (skipped)")
            
            if args.verbose and message:
                print(f"  {message}")
                
        except Exception as e:
            error_count += 1
            print(f"✗ Error processing {file_path}: {e}")
    
    # Summary
    print(f"\n=== SUMMARY ===")
    print(f"Files processed: {len(source_files)}")
    print(f"Modified: {modified_count}")
    print(f"Skipped: {skipped_count}")
    print(f"Errors: {error_count}")
    
    if args.dry_run:
        print("\nRun without --dry-run to apply changes.")
    
    return 0 if error_count == 0 else 1

if __name__ == '__main__':
    exit(main()) 