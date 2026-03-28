#!/usr/bin/env python3
"""Render a contribution report from parsed git data.

Usage:
    python render_report.py --data stats.json --output report.md [--title "Week of ..."]

Reads JSON stats from parse_git_data.py output and renders a markdown report.
"""
import json
import sys
from pathlib import Path

def render_markdown(stats, title="Team Contribution Report"):
    lines = [f"# {title}", ""]

    if not stats or 'error' in stats:
        lines.append("No data available for this period.")
        return '\n'.join(lines)

    # Summary table
    lines.append("## Summary")
    lines.append("")
    lines.append("| Contributor | Commits | Files Changed | Insertions | Deletions |")
    lines.append("|------------|---------|---------------|------------|-----------|")

    total_commits = total_files = total_ins = total_dels = 0
    for author, data in sorted(stats.items()):
        lines.append(f"| {author} | {data['commits']} | {data['files_changed']} | +{data['insertions']} | -{data['deletions']} |")
        total_commits += data['commits']
        total_files += data['files_changed']
        total_ins += data['insertions']
        total_dels += data['deletions']

    lines.append(f"| **Total** | **{total_commits}** | **{total_files}** | **+{total_ins}** | **-{total_dels}** |")
    lines.append("")

    # Per-contributor detail
    lines.append("## Details")
    lines.append("")
    for author, data in sorted(stats.items()):
        lines.append(f"### {author}")
        lines.append(f"- Commits: {data['commits']}")
        lines.append(f"- Files changed: {data['files_changed']}")
        lines.append(f"- Lines: +{data['insertions']} / -{data['deletions']}")
        lines.append("")

    return '\n'.join(lines)

def main():
    data_path = output_path = title = None
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == '--data' and i + 1 < len(args): data_path = args[i + 1]
        if arg == '--output' and i + 1 < len(args): output_path = args[i + 1]
        if arg == '--title' and i + 1 < len(args): title = args[i + 1]

    if not data_path:
        print('Usage: render_report.py --data stats.json [--output report.md]', file=sys.stderr)
        sys.exit(1)

    stats = json.loads(Path(data_path).read_text())
    report = render_markdown(stats, title or "Team Contribution Report")

    if output_path:
        Path(output_path).write_text(report)
        print(json.dumps({"output": output_path, "lines": len(report.split('\n'))}))
    else:
        print(report)

if __name__ == '__main__':
    main()
