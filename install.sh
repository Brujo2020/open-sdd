#!/bin/bash
# Open-SDD | One-command install into an existing repository
#
# Usage:
#   bash install.sh /path/to/your/repo [agent flags...]
#
# Examples:
#   bash install.sh ~/projects/api                 # Claude Code (default)
#   bash install.sh ~/projects/api --cursor-skills # Cursor skills
#   bash install.sh ~/projects/api --lang es -y    # Spanish, no prompts
#
# The previous version of this script copied TypeScript files into `$REPO/src/cli/`. That layout
# never existed in this repository in any commit, so the script could not work. This one drives
# the real CLI that ships in `tools/open-sdd/dist`, which is also what the npm package exposes.

set -euo pipefail

REPO="${1:-}"
if [ -z "$REPO" ]; then
  echo "Usage: bash install.sh /path/to/your/repo [agent flags...]"
  echo ""
  echo "Example:"
  echo "  bash install.sh ~/projects/api --cursor-skills"
  exit 1
fi
shift || true

if [ ! -d "$REPO" ]; then
  echo "Target is not a directory: $REPO"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/tools/open-sdd/dist/cli.js"

if [ ! -f "$CLI" ]; then
  echo "Building the CLI (first run)..."
  ( cd "$SCRIPT_DIR" && npm install && npm run build )
fi

if [ ! -f "$CLI" ]; then
  echo "Build did not produce $CLI"
  exit 1
fi

echo "Installing open-sdd into $REPO ..."
echo ""

# The CLI resolves the target from its working directory, so run it inside the target repo.
( cd "$REPO" && node "$CLI" "$@" )

echo ""
echo "Done. Installed artifacts live under $REPO/.sdd and the selected agent's skill directory."
echo ""
echo "Next:"
echo "  cd $REPO"
echo "  node \"$CLI\" gates chain           # resolve the Zero-Trust chain"
echo "  node \"$CLI\" gates run             # run the declared controls"
echo "  node \"$CLI\" --help                # all flags and agent options"
