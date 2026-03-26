#!/usr/bin/env python3
"""Query the devt learning playbook FTS5 database.

Usage:
    python query.py <search_terms> [--db PATH] [--limit N]
    python query.py "error handling repository pattern" --limit 5

Searches the FTS5 index for matching lessons and returns them ranked by relevance.
If no database exists, falls back to grep-based search on learning-playbook.md.
"""
import sys
import sqlite3
import json
import os
from pathlib import Path


def get_db_path():
    # Check CLAUDE_PLUGIN_DATA first, fall back to plugin root
    plugin_data = os.environ.get('CLAUDE_PLUGIN_DATA', '')
    if plugin_data:
        return Path(plugin_data) / 'semantic' / 'lessons.db'
    # Fallback: relative to script
    return Path(__file__).parent.parent.parent.parent / 'memory' / 'semantic' / 'lessons.db'


def get_playbook_path():
    plugin_data = os.environ.get('CLAUDE_PLUGIN_DATA', '')
    if plugin_data:
        return Path(plugin_data) / 'learning-playbook.md'
    return Path(__file__).parent.parent.parent.parent / 'memory' / 'learning-playbook.md'


def query_fts(terms, db_path, limit=10):
    """Query FTS5 database for matching lessons."""
    if not db_path.exists():
        return None  # Signal to use fallback

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            """SELECT description, category, tags, evidence, importance, confidence, decay_days, created_at,
                      rank
               FROM lessons
               WHERE lessons MATCH ?
               ORDER BY rank
               LIMIT ?""",
            (terms, limit)
        )
        results = []
        for row in cursor:
            results.append({
                'description': row['description'],
                'category': row['category'],
                'tags': row['tags'],
                'evidence': row['evidence'],
                'importance': row['importance'],
                'confidence': row['confidence'],
                'decay_days': row['decay_days'],
                'created_at': row['created_at']
            })
        return results
    except sqlite3.OperationalError:
        return None  # Table doesn't exist yet
    finally:
        conn.close()


def fallback_grep(terms, playbook_path, limit=10):
    """Grep-based fallback when no FTS database exists."""
    if not playbook_path.exists():
        return []

    content = playbook_path.read_text()
    keywords = terms.lower().split()
    entries = content.split('\n---\n')  # YAML entries separated by ---

    scored = []
    for entry in entries:
        lower = entry.lower()
        score = sum(1 for kw in keywords if kw in lower)
        if score > 0:
            scored.append({'text': entry.strip(), 'score': score})

    scored.sort(key=lambda x: x['score'], reverse=True)
    return scored[:limit]


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Query devt learning playbook')
    parser.add_argument('terms', nargs='+', help='Search terms')
    parser.add_argument('--db', help='Path to FTS5 database')
    parser.add_argument('--limit', type=int, default=10, help='Max results')
    parser.add_argument('--playbook', help='Path to learning-playbook.md')
    args = parser.parse_args()

    terms = ' '.join(args.terms)
    db_path = Path(args.db) if args.db else get_db_path()
    limit = args.limit

    results = query_fts(terms, db_path, limit)

    if results is None:
        # Fallback to grep
        playbook_path = Path(args.playbook) if args.playbook else get_playbook_path()
        fallback = fallback_grep(terms, playbook_path, limit)
        output = {'source': 'grep_fallback', 'query': terms, 'count': len(fallback), 'results': fallback}
    else:
        output = {'source': 'fts5', 'query': terms, 'count': len(results), 'results': results}

    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
