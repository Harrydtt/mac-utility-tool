# MacCleaner Build Notes

## Build Commands

### Development
```bash
npm start                    # Run app in dev mode
npm run electron:dev         # Same as start
```

### Production Build
```bash
npm run electron:build       # Build both ARM64 and x64
npm run electron:build:arm64 # Build ARM64 only
npm run electron:build:x64   # Build x64 only
```

## Build Output

Builds are generated in `/dist`:
- **DMG**: `MacCleaner-1.0.0-arm64.dmg` and `MacCleaner-1.0.0.dmg`
- **PKG**: `MacCleaner-1.0.0-arm64.pkg` and `MacCleaner-1.0.0.pkg` (with auto gatekeeper bypass)
- **ZIP**: `MacCleaner-1.0.0-arm64-mac.zip` and `MacCleaner-1.0.0-mac.zip`
- **App bundles**: `/dist/mac-arm64/MacCleaner.app` and `/dist/mac/MacCleaner.app`

## Architecture-Specific Build Configs

**IMPORTANT**: Do NOT build both architectures concurrently with a single `electron-builder` command. This causes PKG build failures due to temporary file conflicts (`com.maccleaner.app.pkg`).

### Why Separate Configs?

electron-builder has a bug where building multiple architectures with PKG target causes:
```
ENOENT: no such file or directory, unlink 'dist/com.maccleaner.app.pkg'
```

**Solution**: Build architectures sequentially using separate config files.

### Config Files

1. **electron-builder-arm64.json** - ARM64 build only
2. **electron-builder-x64.json** - x64 build only

Both configs:
- Have standalone settings (no `extends`)
- Include PKG scripts for gatekeeper bypass: `resources/pkg-scripts/postinstall`
- Use same icon: `assets/tray-icon.png`

### Build Script Flow

```bash
npm run electron:build
```

Executes:
1. `tsc` - Compile main TypeScript
2. `tsc -p electron/tsconfig.json` - Compile Electron TypeScript
3. Copy preload and main files to dist
4. `npm run electron:build:arm64` - Build ARM64 with separate config
5. `npm run electron:build:x64` - Build x64 with separate config

## PKG Installer Features

### Gatekeeper Bypass Script

Location: `resources/pkg-scripts/postinstall`

The PKG installer includes a post-install script that automatically removes the quarantine attribute:
```bash
#!/bin/bash
xattr -cr /Applications/MacCleaner.app
```

This prevents "App is damaged" errors when users install from PKG.

**Requirements**:
- Script must have execute permission: `chmod +x resources/pkg-scripts/postinstall`
- Configured in both electron-builder configs:
  ```json
  "pkg": {
    "scripts": "resources/pkg-scripts",
    "installLocation": "/Applications"
  }
  ```

## Troubleshooting

### PKG Build Fails with "distribution.xml not found"

**Cause**: Building both x64 and arm64 concurrently.

**Fix**: Use separate configs (already implemented):
```bash
npm run electron:build:arm64  # Build ARM64 first
npm run electron:build:x64    # Then build x64
```

### "Application entry file does not exist" Error

**Cause**: Missing compiled files in dist.

**Fix**: Run full compile before build:
```bash
rm -rf dist
npm run electron:build  # Already includes compile step
```

### Changes to package.json "build" Section Not Applying

**Cause**: Using separate config files that override package.json settings.

**Fix**: Edit `electron-builder-arm64.json` and `electron-builder-x64.json` instead.

### Need to Add New Build Target

Edit both config files:
```json
{
  "mac": {
    "target": [
      // Add new target here for both configs
    ]
  }
}
```

## FDA (Full Disk Access) Implementation

### Overview

The app requires FDA for accessing protected folders:
- Trash (`~/.Trash`)
- Mail Attachments (`~/Library/Mail/Downloads`)
- iOS Backups (`~/Library/Application Support/MobileSync/Backup`)

### UI Features

1. **Persistent FDA Wizard** (Dashboard)
   - Location: Below "Reset Layout" button
   - Shows 3-step guide when FDA not granted
   - Real-time polling (every 3 seconds)
   - Auto-hides when FDA granted

2. **Category FDA Badges**
   - Shows "🔐 Needs FDA" on protected categories
   - Disables checkboxes when FDA not granted
   - Auto-removes when FDA granted

3. **Auto-Rescan on FDA Grant**
   - Automatically rescans protected categories
   - Preserves other category selections
   - Auto-checks Safe zone categories (except Trash if delete mode is "Move to Trash")

### Key Files

- `src/ui/app.js`: FDA wizard, polling, badge logic
- `src/ui/joke.js`: FDA wizard for Super Mode
- `src/ui/hidden-gems.js`: Pro mode unlock persistence
- `src/utils/full-disk-access.ts`: FDA check implementation

### FDA State Management

Global variables in `app.js`:
```javascript
let hasFDA = false;              // Current FDA status
let fdaPollingInterval = null;   // Polling interval ID
let fdaWizardStep = 1;           // Current wizard step (1-3)
const FDA_REQUIRED_CATEGORIES = ['trash', 'mail-attachments', 'ios-backups'];
```

### Polling Behavior

- **Continuous**: Runs as long as on dashboard
- **Frequency**: Every 3 seconds
- **Detects**: Both FDA grant AND revoke
- **Actions on Grant**: Update wizard, remove badges, auto-rescan
- **Actions on Revoke**: Show wizard, add badges, scroll to wizard

## Pro Mode (Hidden Gems)

### Unlock Command

In DevTools console:
```javascript
window.unlockHiddenGemsPro()
```

### Persistence

State saved to localStorage:
```javascript
localStorage.getItem('mac-cleaner-gems-unlocked') === 'true'
```

Auto-restores on page load.

### Features Unlocked

- Super Mode (Joke page with FDA)
- AI Cat Helper settings

## Testing FDA Flow

1. **Without FDA**:
   - Dashboard shows FDA wizard
   - Protected categories have "🔐 Needs FDA" badge
   - Checkboxes disabled for protected categories
   - Click on protected category → alert + scroll to wizard

2. **Granting FDA**:
   - Click "Open Settings" → Step 1 ✓
   - Add app to FDA list → Step 2 active
   - Toggle ON → All steps ✓, wizard hides, badges removed
   - Auto-rescan starts for protected categories

3. **Revoking FDA**:
   - Remove app from FDA list
   - Within 3 seconds: wizard reappears, badges return
   - Auto-scroll to wizard

## Notes

- **No app restart required** when granting/revoking FDA
- **Delete mode check**: Trash category not auto-checked if delete mode is "Move to Trash"
- **Checkbox preservation**: Existing selections preserved during FDA rescan
- **Safe zone auto-check**: FDA categories auto-checked after rescan if in Safe zone

---

Last updated: 2025-12-27
