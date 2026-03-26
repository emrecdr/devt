#!/usr/bin/env python3
"""Archive stale lessons from the FTS5 database.

Usage:
    python compact.py [--db PATH] [--max-age DAYS] [--min-importance N] [--dry-run]

Archives lessons that are:
- Older than decay_days AND importance < 5 AND confidence < 0.5
- Or explicitly past their max-age threshold
"""
import sys
import sqlite3
import json
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta


def get_db_path():
    plugin_data = os.environ.get('CLAUDE_PLUGIN_DATA', '')
    if plugin_data:
        return Path(plugin_data) / 'semantic' / 'lessons.db'
    return Path(__file__).parent.parent.parent.parent / 'memory' / 'semantic' / 'lessons.db'


def compact(db_path, max_age_days=90, min_importance=5, min_confidence=0.5, dry_run=False):
    """Remove stale entries from FTS5 table."""
    if not db_path.exists():
        return {'archived': 0, 'reason': 'no database found'}

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    # Find candidates for archival
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()

    try:
        candidates = conn.execute(
            """SELECT rowid, description, importance, confidence, created_at, decay_days
               FROM lessons
               WHERE CAST(importance AS INTEGER) < ?
                 AND CAST(confidence AS REAL) < ?""",
            (min_importance, min_confidence)
        ).fetchall()

        to_archive = []
        for row in candidates:
            created = row['created_at'] or ''
            decay = int(row['decay_days'] or 90)
            # Check if past decay period
            if created and created < cutoff:
                to_archive.append({
                    'rowid': row['rowid'],
                    'description': row['description'][:80],
                    'importance': row['importance'],
                    'confidence': row['confidence']
                })

        if not dry_run and to_archive:
            rowids = [r['rowid'] for r in to_archive]
            placeholders = ','.join('?' * len(rowids))
            conn.execute(f"DELETE FROM lessons WHERE rowid IN ({placeholders})", rowids)
            conn.commit()

        return {
            'archived': len(to_archive),
            'dry_run': dry_run,
            'candidates': to_archive if dry_run else [],
            'db': str(db_path)
        }
    finally:
        conn.close()


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Archive stale lessons')
    parser.add_argument('--db', help='Path to SQLite database')
    parser.add_argument('--max-age', type=int, default=90, help='Max age in days')
    parser.add_argument('--min-importance', type=int, default=5, help='Min importance to keep')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be archived')
    args = parser.parse_args()

    db_path = Path(args.db) if args.db else get_db_path()
    result = compact(db_path, args.max_age, args.min_importance, dry_run=args.dry_run)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
