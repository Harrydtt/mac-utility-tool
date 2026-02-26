#!/bin/bash

# Simplified build script for Electron app

echo "🔨 Building Mac Cleaner Electron App..."

# Clean old build
echo "🧹 Cleaning old build..."
rm -rf dist

# Single compilation for entire project
echo "📦 Compiling TypeScript..."
npx tsc
if [ $? -ne 0 ]; then
    echo "❌ Failed to compile"
    exit 1
fi

echo "✅ Build complete!"

# Copy compiled UI scripts to src/ui so index.html can find them
echo "📋 Copying UI scripts to src/ui..."
cp dist/src/ui/send-manager.js src/ui/
cp dist/src/ui/receive-manager.js src/ui/
cp dist/src/ui/transfer-feature.js src/ui/

echo ""
echo "📁 Output structure:"
echo "   dist/src/       - Compiled source code"
echo "   dist/electron/  - Compiled Electron code"
echo ""
echo "🚀 To run the app:"
echo "   npx electron ."
echo ""
echo "📦 To package the app:"
echo "   npm run electron:build"
