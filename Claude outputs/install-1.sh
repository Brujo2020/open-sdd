#!/bin/bash
# Open-SDD | One-Command Install
# Usage: bash install.sh /path/to/your/open-sdd-repo

set -e

REPO="${1:-.}"

if [ ! -d "$REPO/src/cli" ]; then
  echo "❌ Usage: bash install.sh /path/to/open-sdd-repo"
  echo ""
  echo "Example:"
  echo "  bash install.sh ~/projects/open-sdd"
  exit 1
fi

echo "🚀 Open-SDD Installing..."
echo ""

# Copy core files
echo "📂 Installing 9 features..."
mkdir -p "$REPO/src/cli/ui" "$REPO/src/cli/core" "$REPO/src/cli/commands"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Core modules (Features 1-9)
for file in "$SCRIPT_DIR"/src/cli/core/*.ts; do
  [ -f "$file" ] && cp "$file" "$REPO/src/cli/core/" && echo "  ✓ $(basename $file)"
done

# UI modules
for file in "$SCRIPT_DIR"/src/cli/ui/*.ts; do
  [ -f "$file" ] && cp "$file" "$REPO/src/cli/ui/" && echo "  ✓ $(basename $file)"
done

# Handlers
for file in "$SCRIPT_DIR"/src/cli/commands/*.ts; do
  [ -f "$file" ] && cp "$file" "$REPO/src/cli/commands/" && echo "  ✓ $(basename $file)"
done

# Install dependencies
cd "$REPO"
echo ""
echo "📦 Installing dependencies..."
npm install chalk --silent 2>/dev/null || npm install chalk

# Build
echo "🔨 Building..."
npm run build --silent 2>/dev/null || npm run build

echo ""
echo "✅ Installation complete!"
echo ""
echo "📝 Next step: Wire 3 imports in src/cli/index.ts"
echo ""
echo "Add imports:"
echo '  import { handleSpecEARSStrict } from "./commands/spec-ears-strict.js";'
echo '  import { handleRollbackRetry } from "./commands/rollback-retry.js";'
echo ""
echo "Add cases to router:"
echo '  case "/sdd-spec-ears-strict":'
echo '    await handleSpecEARSStrict(args);'
echo '    break;'
echo ""
echo "🧪 Then test:"
echo "  /sdd-impl auth --preview"
echo "  /sdd-spec-ears-strict auth"
echo "  /sdd-impl auth --checkpoint --git --profile"
echo ""
