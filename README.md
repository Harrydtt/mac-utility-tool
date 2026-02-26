<p align="center">
  <h1 align="center">🧹 Mac Ultility Tool</h1>
  <p align="center">
    <strong>Your Mac, Your Control. 100% Offline & Private.</strong>
  </p>
  <p align="center">
    Free up disk space with zero tracking. No data leaves your machine. You decide exactly what to delete.
  </p>
</p>

---


---

## ✨ Features Breakdown

### 🚀 Smart & Safe Cleaning
- **Deep Clean**: Intelligently scans specific system paths to remove cache, logs, and temporary files without touching your personal data.
- **Safety First**: Buil-in **Safety Mode** prevents deleting critical system files. You can customize the **Safelist** to protect specific folders or extensions.

### 🛡️ Threat Detection
- **Integrated ClamAV Engine**: Uses the powerful open-source ClamAV engine to detect potential threats and malicious files hiding in your system.
- **Real-time Stats**: Shows you exactly what's being scanned.

### ⚙️ Power User Tools
- **Scheduler**: Set it and forget it! Configure auto-cleaning schedules (Daily, Weekly) to keep your Mac running smooth.
- **App Uninstaller**: Don't just delete the app—remove its leftover preferences, caches, and support files instantly.

---

## 💎 Hidden Gems

As a token of appreciation for those who support the project's development, we've prepared these special features as a **Thank You** gift:

### 🌪️ Super Mode
Activate the secret **Super Mode** for an "explosive" cleaning experience. Warning: It's extremely powerful! (Try it to believe it 😉)

### 🐱 AI Cat Helper
Meet your new best friend! This smart animated assistant lives in your menu bar.
- **Smart Tips**: Gives you advice on how to save space.
- **Interactive**: It reacts to your actions and keeps you company while cleaning.
- **Personality**: It's not just a bot, it's a companion!

---

## 🔄 Auto-Update & Manual Release Steps
Mac Ultility Tool features an automatic updater that checks GitHub Releases for new versions.

### How to Publish a New Release manually
1. **Bump Version:** Update the `version` field in `package.json`.
2. **Build the Application:** Ensure you have the `GH_TOKEN` environment variable set, then run:
   ```bash
   npm run build
   ```
   This will generate the `.dmg`, `.zip`, and `latest-mac.yml` files inside the `dist` directory.
   By default, `electron-builder` is configured to publish a *draft* release onto GitHub.
3. **Publish the Release:**
   Go to your [GitHub repository releases page](https://github.com/Harrydtt/mac-utility-tool/releases). Find the draft release created by the build step, edit it, add release notes in the description, and publish it. The auto-updater will now detect the new release!

## 📥 Download

Download the latest version for your Mac:

- **[Download for Intel Mac (.dmg)](https://github.com/Harrydtt/mac-utility-tool/releases/latest)**
- **[Download for Apple Silicon (M1/M2/M3) (.dmg)](https://github.com/Harrydtt/mac-utility-tool/releases/latest)**

## 🔧 How to Install

1. Download the `.dmg` file for your Mac architecture via the links above.
2. Open the file and drag **Mac Ultility Tool** to your **Applications** folder.
3. **Important for first launch**:
   - Since this is a free open-source app, macOS might check for developer verification.
   - For the first time, **Right-click** (or Control-click) the Mac Ultility Tool app icon and select **Open**.
   - Click **Open** again in the confirmation dialog.

## ⚙️ Setup Permissions (Important)

To scan and clean hidden junk files effectively, Mac Ultility Tool needs **Full Disk Access**.

1. Open **System Settings** (or System Preferences).
2. Go to **Privacy & Security** > **Full Disk Access**.
3. Look for **Mac Ultility Tool** in the list and turn the toggle **ON**.
   - *If you don't see it:* Click the **+** button at the bottom, navigate to your Applications folder, and select Mac Ultility Tool.
4. Restart the app if prompted.


> 🔒 **Note**: We respect your privacy. This permission is ONLY used to scan for junk files and caches on your disk. No personal data is ever collected or sent anywhere.

## 🛠️ Troubleshooting

### "App is damaged and can't be opened" Error
If you see a message saying **"Mac Ultility Tool.app is damaged and can't be opened"**, do not worry. This is a common warning for open-source apps that aren't notarized by Apple.

**To fix it:**

1. Move **Mac Ultility Tool** to your **Applications** folder.
2. Open the **Terminal** app.
3. Paste the following command and hit Enter:
   ```bash
   xattr -cr "/Applications/Mac Ultility Tool.app"
   ```
4. Now you can open the app normally!

---

<p align="center">
  Made with ❤️
</p>
