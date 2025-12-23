# Electron Desktop App - Installation & Usage

## Prerequisites

- Node.js >= 20.12.0
- npm or bun

## Installation

```bash
# Install dependencies
npm install

# Or with bun
bun install
```

## Development

```bash
# Run in development mode
npm run electron:dev

# Or
npm start
```

This will:
1. Compile TypeScript for Electron
2. Launch the app with DevTools open

## Building

```bash
# Build for production
npm run electron:build
```

This creates:
- `.dmg` installer in `release/` directory
- `.zip` archive for distribution

## Project Structure

```
electron/
├── main.ts       # Main process (Node.js with full system access)
├── preload.ts    # IPC bridge (secure API exposure)
└── tsconfig.json # TypeScript config for Electron

src/
├── scanners/     # File scanning logic (reused from CLI)
├── utils/        # Utilities (config, history, trash)
└── ui/           # Frontend (HTML/CSS/JS)

dist/
├── electron/     # Compiled Electron code
└── ...           # Compiled CLI code
```

## How It Works

1. **Main Process** (`electron/main.ts`):
   - Runs with full Node.js access
   - Creates app window
   - Handles IPC requests from UI
   - Executes file operations (scan, clean, etc.)

2. **Renderer Process** (UI):
   - Runs in sandboxed browser window
   - Communicates via IPC (no direct file access)
   - Uses `window.electronAPI.*` methods

3. **Preload Script** (`electron/preload.ts`):
   - Bridges main and renderer
   - Exposes safe API to UI
   - Prevents security vulnerabilities

## Differences from Web Version

| Feature | Web App | Desktop App |
|---------|---------|-------------|
| File Access | Limited (via server) | Full (native) |
| Permissions | Browser sandbox | System-level |
| Trash API | AppleScript | Native macOS |
| Sudo Support | ❌ No | ✅ Yes (if needed) |
| Distribution | localhost:3000 | .app / .dmg |
| Size | ~5MB | ~100MB (includes Chromium) |

## Troubleshooting

### "electron: command not found"
```bash
npm install
```

### TypeScript errors
```bash
# Rebuild
npm run build
```

### App won't launch
```bash
# Check logs
npm run electron:dev
# Look for errors in terminal
```

## Next Steps

After installation works:
1. Test scanning
2. Test cleaning (with trash mode first!)
3. Verify settings persistence
4. Test history tracking
5. Build and test packaged .app
