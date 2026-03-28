#!/usr/bin/env python3
"""Compute the reporting time window.

Usage:
    python compute_window.py [--weeks N]

Returns JSON with window_start, window_end, filename_suffix, and suggested git/parser commands.
Default: last 7 days (Monday to Sunday).
"""
import json
import sys
from datetime import datetime, timedelta, timezone

def compute_window(weeks=1):
    today = datetime.now(timezone.utc)
    # Find last Monday
    days_since_monday = today.weekday()
    last_monday = today - timedelta(days=days_since_monday + 7 * (weeks - 1))
    last_monday = last_monday.replace(hour=0, minute=0, second=0, microsecond=0)
    window_end = last_monday + timedelta(days=7 * weeks)

    suffix = f"{last_monday.strftime('%Y%m%d')}-{window_end.strftime('%Y%m%d')}"

    return {
        "window_start": last_monday.isoformat(),
        "window_end": window_end.isoformat(),
        "filename_suffix": suffix,
        "weeks": weeks,
        "git_command": f"git log --all --after='{last_monday.strftime('%Y-%m-%d')}' --before='{window_end.strftime('%Y-%m-%d')}' --format='%H|%an|%ai|%s' --numstat",
        "parser_command": f"python parse_git_data.py --from '{last_monday.strftime('%Y-%m-%d')}' --to '{window_end.strftime('%Y-%m-%d')}'"
    }

def main():
    weeks = 1
    if '--weeks' in sys.argv:
        idx = sys.argv.index('--weeks')
        if idx + 1 < len(sys.argv):
            weeks = int(sys.argv[idx + 1])
    print(json.dumps(compute_window(weeks), indent=2))

if __name__ == '__main__':
    main()
