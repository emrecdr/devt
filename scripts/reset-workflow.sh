#!/usr/bin/env bash
# Reset devt workflow state
STATE_DIR=".devt-state"
if [[ -d "$STATE_DIR" ]]; then
  rm -f "$STATE_DIR"/*.md "$STATE_DIR"/*.yaml "$STATE_DIR"/*.json
  echo "Workflow state reset (all .devt-state/ files cleaned)"
else
  echo "No .devt-state/ directory found"
fi
