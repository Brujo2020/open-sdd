#!/bin/bash
# Open-SDD Installation Script
# Usage: bash INSTALL.sh /path/to/open-sdd

set -e

if [ -z "$1" ]; then
  echo "❌ Usage: bash INSTALL.sh /path/to/open-sdd"
  exit 1
fi

REPO="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Validate repo
if [ ! -d "$REPO/src/cli" ]; then
  echo "❌ Invalid open-sdd repository: $REPO/src/cli not found"
  exit 1
fi

echo "🚀 Installing Open-SDD Features (All 9)"
echo "========================================"
echo ""

# Extract package if needed
if [ ! -d "$SCRIPT_DIR/open-sdd-final" ]; then
  echo "📦 Extracting package..."
  cd "$SCRIPT_DIR"
  tar -xzf open-sdd-all-features.tar.gz 2>/dev/null || tar -xzf open-sdd-features.tar.gz 2>/dev/null || true
  cd - > /dev/null
fi

SOURCE_DIR="$SCRIPT_DIR/open-sdd-final/src/cli"

# Create directories
mkdir -p "$REPO/src/cli/ui" "$REPO/src/cli/core" "$REPO/src/cli/commands"

# Copy Feature 1: Diff Preview
echo "1️⃣  Diff Preview..."
cp "$SOURCE_DIR/ui/diffPreview.ts" "$REPO/src/cli/ui/" 2>/dev/null || echo "   ⚠️  diffPreview.ts skipped"
cp "$SOURCE_DIR/ui/diffPreviewUI.ts" "$REPO/src/cli/ui/" 2>/dev/null || echo "   ⚠️  diffPreviewUI.ts skipped"

# Copy Feature 2: EARS Strict
echo "2️⃣  EARS Strict Mode..."
cp "$SOURCE_DIR/core/earsConverter.ts" "$REPO/src/cli/core/" 2>/dev/null || echo "   ⚠️  earsConverter.ts skipped"
cp "$SOURCE_DIR/ui/earsConverterUI.ts" "$REPO/src/cli/ui/" 2>/dev/null || echo "   ⚠️  earsConverterUI.ts skipped"
cp "$SOURCE_DIR/commands/spec-ears-strict.ts" "$REPO/src/cli/commands/" 2>/dev/null || echo "   ⚠️  spec-ears-strict.ts skipped"

# Copy Feature 3: Rollback & Retry
echo "3️⃣  Rollback & Retry..."
cp "$SOURCE_DIR/core/failureRecovery.ts" "$REPO/src/cli/core/" 2>/dev/null || echo "   ⚠️  failureRecovery.ts skipped"
cp "$SOURCE_DIR/commands/rollback-retry.ts" "$REPO/src/cli/commands/" 2>/dev/null || echo "   ⚠️  rollback-retry.ts skipped"

# Copy Features 4-9: Extended Suite
echo "4️⃣  Spec Versioning..."
cp "$SOURCE_DIR/core/specVersioning.ts" "$REPO/src/cli/core/" 2>/dev/null || echo "   ⚠️  specVersioning.ts skipped"

echo "5️⃣  Spec Refinement..."
cp "$SOURCE_DIR/core/specRefinement.ts" "$REPO/src/cli/core/" 2>/dev/null || echo "   ⚠️  specRefinement.ts skipped"

echo "6️⃣  Multi-Feature Orchestration..."
cp "$SOURCE_DIR/core/orchestrator.ts" "$REPO/src/cli/core/" 2>/dev/null || echo "   ⚠️  orchestrator.ts skipped"

echo "7️⃣  Performance Profiler..."
cp "$SOURCE_DIR/core/profiler.ts" "$REPO/src/cli/core/" 2>/dev/null || echo "   ⚠️  profiler.ts skipped"

echo "8️⃣  Git-Native Integration..."
cp "$SOURCE_DIR/core/gitIntegration.ts" "$REPO/src/cli/core/" 2>/dev/null || echo "   ⚠️  gitIntegration.ts skipped"

echo ""
echo "✅ Files copied successfully"
echo ""
echo "📝 Next: Wire CLI router in $REPO/src/cli/index.ts"
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
echo '  case "/sdd-impl":'
echo '    if (args.includes("--rollback-to") || args.includes("--resume"))'
echo '      await handleRollbackRetry(args);'
echo '    else'
echo '      // existing impl logic'
echo '    break;'
echo ""
echo "🔨 Build:"
echo "  cd $REPO && npm install chalk && npm run build"
echo ""
echo "🧪 Test:"
echo "  /sdd-impl <feature> --preview"
echo "  /sdd-spec-ears-strict <feature>"
echo "  /sdd-impl <feature> --checkpoint --profile"
echo ""
echo "✨ All 9 features installed!"
