#!/usr/bin/env python3
"""Parse git log output into structured contributor data.

Usage:
    python parse_git_data.py --from YYYY-MM-DD --to YYYY-MM-DD [--config PATH]

Reads git log from stdin or runs git log internally.
Reads contributor mapping from .devt.json (git.contributors).
Outputs JSON with per-contributor stats: commits, files changed, insertions, deletions.
"""
import json
import sys
import subprocess
import os
from pathlib import Path

def load_contributors(config_path=None):
    """Load contributor mapping from .devt.json."""
    if config_path:
        p = Path(config_path)
    else:
        p = Path('.devt.json')
    if p.exists():
        config = json.loads(p.read_text())
        return config.get('git', {}).get('contributors', [])
    return []

def match_contributor(author, contributors):
    """Match git author to configured contributor."""
    for c in contributors:
        if c.get('git_match', '').lower() in author.lower():
            return c.get('name', author)
    return author

def parse_git_log(from_date, to_date, contributors):
    """Run git log and parse into structured data."""
    cmd = [
        'git', 'log', '--all',
        f'--after={from_date}', f'--before={to_date}',
        '--format=%H|%an|%ai|%s', '--numstat'
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        lines = result.stdout.strip().split('\n')
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return {'error': 'git command failed'}

    stats = {}
    current_author = None

    for line in lines:
        if '|' in line and line.count('|') >= 3:
            parts = line.split('|', 3)
            raw_author = parts[1].strip()
            current_author = match_contributor(raw_author, contributors)
            if current_author not in stats:
                stats[current_author] = {'commits': 0, 'insertions': 0, 'deletions': 0, 'files': set()}
            stats[current_author]['commits'] += 1
        elif '\t' in line and current_author:
            parts = line.split('\t')
            if len(parts) >= 3:
                ins = int(parts[0]) if parts[0] != '-' else 0
                dels = int(parts[1]) if parts[1] != '-' else 0
                stats[current_author]['insertions'] += ins
                stats[current_author]['deletions'] += dels
                stats[current_author]['files'].add(parts[2])

    # Convert sets to counts
    for author in stats:
        stats[author]['files_changed'] = len(stats[author].pop('files'))

    return stats

def main():
    from_date = to_date = None
    config_path = None

    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == '--from' and i + 1 < len(args): from_date = args[i + 1]
        if arg == '--to' and i + 1 < len(args): to_date = args[i + 1]
        if arg == '--config' and i + 1 < len(args): config_path = args[i + 1]

    if not from_date or not to_date:
        print('Usage: parse_git_data.py --from YYYY-MM-DD --to YYYY-MM-DD', file=sys.stderr)
        sys.exit(1)

    contributors = load_contributors(config_path)
    stats = parse_git_log(from_date, to_date, contributors)
    print(json.dumps(stats, indent=2))

if __name__ == '__main__':
    main()
