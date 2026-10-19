#!/bin/bash
# Direct push to GitHub - no downloads needed
# Usage: bash DIRECT-PUSH.sh /path/to/CursoOpenUSD

REPO="${1:-.}"

if [ ! -d "$REPO/.git" ]; then
  echo "❌ Not a git repo: $REPO"
  exit 1
fi

cd "$REPO"

# Create open-sdd folder
mkdir -p open-sdd

# Copy files from this script's directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "📂 Copying files..."
cp "$SCRIPT_DIR/install.sh" open-sdd/ 2>/dev/null || echo "⚠️  install.sh not found"
cp "$SCRIPT_DIR/GITHUB-README.md" open-sdd/README.md 2>/dev/null || echo "⚠️  README.md not found"
cp "$SCRIPT_DIR/open-sdd-all-features.tar.gz" open-sdd/ 2>/dev/null || echo "⚠️  Package not found"

# Verify
if [ ! -f "open-sdd/install.sh" ]; then
  echo "❌ Files not copied. Check paths."
  exit 1
fi

echo "✅ Files ready"
echo ""
echo "Now:"
echo "  git add open-sdd/"
echo "  git commit -m 'feat: add open-sdd'"
echo "  git push origin main"
echo ""
echo "Wait 10 seconds, then:"
echo "  curl -fsSL https://github.com/Brujo2020/CursoOpenUSD/raw/main/open-sdd/install.sh | bash -s /path/to/open-sdd"
