#!/usr/bin/env python3
"""Sync learning-playbook.md entries into SQLite FTS5 database.

Usage:
    python sync.py [--playbook PATH] [--db PATH] [--schema PATH]

Parses YAML entries from the playbook and upserts them into the FTS5 table.
Creates the database and table if they don't exist.
"""
import sys
import sqlite3
import json
import os
import re
from pathlib import Path


def get_paths():
    plugin_data = os.environ.get('CLAUDE_PLUGIN_DATA', '')
    plugin_root = os.environ.get('CLAUDE_PLUGIN_ROOT', str(Path(__file__).parent.parent.parent.parent))

    if plugin_data:
        db_path = Path(plugin_data) / 'semantic' / 'lessons.db'
        playbook_path = Path(plugin_data) / 'learning-playbook.md'
    else:
        db_path = Path(plugin_root) / 'memory' / 'semantic' / 'lessons.db'
        playbook_path = Path(plugin_root) / 'memory' / 'learning-playbook.md'

    schema_path = Path(plugin_root) / 'memory' / 'semantic' / 'schema.sql'
    return db_path, playbook_path, schema_path


def parse_playbook(playbook_path):
    """Parse YAML-like entries from learning-playbook.md."""
    if not playbook_path.exists():
        return []

    content = playbook_path.read_text()
    entries = []

    # Split by YAML document separators
    blocks = re.split(r'\n---\n', content)

    for block in blocks:
        block = block.strip()
        if not block or block.startswith('#'):
            continue

        entry = {}
        for line in block.split('\n'):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            match = re.match(r'^(\w+):\s*(.+)$', line)
            if match:
                key, value = match.group(1), match.group(2).strip()
                # Strip quotes
                if value.startswith('"') and value.endswith('"'):
                    value = value[1:-1]
                elif value.startswith("'") and value.endswith("'"):
                    value = value[1:-1]
                entry[key] = value

        if entry.get('description'):
            entries.append(entry)

    return entries


def ensure_db(db_path, schema_path):
    """Create database and FTS5 table if they don't exist."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))

    if schema_path.exists():
        conn.executescript(schema_path.read_text())
    else:
        conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS lessons USING fts5(
                description, category, tags, evidence,
                importance UNINDEXED, confidence UNINDEXED,
                decay_days UNINDEXED, created_at UNINDEXED
            )
        """)

    conn.commit()
    return conn


def sync_entries(conn, entries):
    """Clear and re-insert all entries (full sync)."""
    conn.execute("DELETE FROM lessons")

    inserted = 0
    for entry in entries:
        try:
            conn.execute(
                "INSERT INTO lessons (description, category, tags, evidence, importance, confidence, decay_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    entry.get('description', ''),
                    entry.get('category', 'general'),
                    entry.get('tags', ''),
                    entry.get('evidence', ''),
                    entry.get('importance', '5'),
                    entry.get('confidence', '0.5'),
                    entry.get('decay_days', '90'),
                    entry.get('created_at', '')
                )
            )
            inserted += 1
        except sqlite3.Error as e:
            print(f"Warning: skipped entry: {e}", file=sys.stderr)

    conn.commit()
    return inserted


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Sync learning playbook to FTS5')
    parser.add_argument('--playbook', help='Path to learning-playbook.md')
    parser.add_argument('--db', help='Path to SQLite database')
    parser.add_argument('--schema', help='Path to schema.sql')
    args = parser.parse_args()

    db_path, playbook_path, schema_path = get_paths()
    if args.db: db_path = Path(args.db)
    if args.playbook: playbook_path = Path(args.playbook)
    if args.schema: schema_path = Path(args.schema)

    entries = parse_playbook(playbook_path)
    conn = ensure_db(db_path, schema_path)
    inserted = sync_entries(conn, entries)
    conn.close()

    print(json.dumps({'synced': inserted, 'db': str(db_path), 'playbook': str(playbook_path)}))


if __name__ == '__main__':
    main()
