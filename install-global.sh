#!/bin/bash
# Open-SDD | Global install from source
#
# Clones the repository, installs the workspace, builds the CLI and tells you how to run it.
#
# The previous version cloned `Brujo2020/OpenSDD.git` (which does not match the repository URL in
# package.json), suggested an alias pointing at an `install.sh` that had been deleted, and ran
# `npm install` in a way that recursed into its own postinstall script. All three are fixed here.

set -euo pipefail

INSTALL_DIR="${OPEN_SDD_HOME:-$HOME/.open-sdd}"
REPO_URL="${OPEN_SDD_REPO:-https://github.com/Brujo2020/open-sdd.git}"
BRANCH="${OPEN_SDD_BRANCH:-main}"
CLI="$INSTALL_DIR/tools/open-sdd/dist/cli.js"

echo "Installing open-sdd into $INSTALL_DIR ..."

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "Existing checkout found; updating."
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
else
  rm -rf "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR" --depth 1 --branch "$BRANCH"
fi

cd "$INSTALL_DIR"
# Install the workspace explicitly rather than relying on the root lifecycle script.
npm --prefix tools/open-sdd install --no-audit --no-fund
npm run build

if [ ! -f "$CLI" ]; then
  echo "Build did not produce $CLI"
  exit 1
fi

echo ""
echo "Installation complete."
echo ""
echo "Add this to your shell profile to get an 'open-sdd' command:"
echo ""
echo "  alias open-sdd='node \"$CLI\"'"
echo ""
echo "Then:"
echo "  source ~/.zshrc          # or ~/.bashrc"
echo "  cd /path/to/your/repo"
echo "  open-sdd --help"
echo "  open-sdd gates chain     # resolve the Zero-Trust chain"
