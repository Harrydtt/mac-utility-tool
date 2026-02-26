const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'electron/main.ts');
let content = fs.readFileSync(filePath, 'utf8');

const oldLogic = `                // NO ZIP - MULTIPLE FILES -> FALLBACK (Symlink Staging)
                // Create a temporary folder containing SYMLINKS to the real files.
                // This simulates a "folder" without copying data (Fast + No Disk Usage).
                const now = new Date();
                const timestamp = now.toISOString().replace(/T/, '_').replace(/\\..+/, '').replace(/:/g, '-');
                const folderName = \`Batch_\${timestamp}\`; // Clean name for receiver
                const stagingDir = path.join(SENDER_CWD, folderName);

                try {
                    await fs.mkdir(stagingDir, { recursive: true });
                    // @ts-ignore
                    for (const itemPath of session.originalFiles) {
                        const baseName = path.basename(itemPath);
                        // Use symlink (soft link) for zero-copy
                        await fs.symlink(itemPath, path.join(stagingDir, baseName));
                    }
                    fileToSend = stagingDir;
                    session.filename = folderName; // Set correct display name (Folder Name)
                    // Note: We DO NOT delete stagingDir here, because transfer binary needs to read it.
                    // It will be cleaned up by app restart (cleanOrphaned) or we could track it for cleanup.
                } catch (err: any) {
                    session.status = 'failed';
                    session.error = 'Staging failed: ' + err.message;
                    return;
                }`;

const newLogic = `                // NO ZIP - MULTIPLE FILES -> FALLBACK (Recursive Hard Link Layout)
                // Strategy: Create a temporary folder structure w/ HARD LINKS.
                // Binary (sendme) ignores symlinks, so we must use Hard Links or Copy.
                
                const now = new Date();
                const timestamp = now.toISOString().replace(/T/, '_').replace(/\\..+/, '').replace(/:/g, '-');
                const folderName = \`Batch_\${timestamp}\`; // Clean name for receiver
                const stagingDir = path.join(SENDER_CWD, folderName);
                
                try {
                    await fs.mkdir(stagingDir, { recursive: true });

                    // Helper to recursively link contents
                    const linkRecursive = async (src: string, dest: string) => {
                         const stats = await fs.stat(src);
                         if (stats.isDirectory()) {
                             await fs.mkdir(dest, { recursive: true });
                             const children = await fs.readdir(src);
                             for (const child of children) {
                                 await linkRecursive(path.join(src, child), path.join(dest, child));
                             }
                         } else {
                             // Try HARD LINK first (Fast, No Space for same volume)
                             try {
                                 try { await fs.unlink(dest); } catch {}
                                 await fs.link(src, dest);
                             } catch (linkErr: any) {
                                 // Fallback to Copy
                                 await fs.copyFile(src, dest);
                             }
                         }
                    };

                    // @ts-ignore
                    for (const itemPath of session.originalFiles) {
                         const baseName = path.basename(itemPath);
                         await linkRecursive(itemPath, path.join(stagingDir, baseName));
                    }
                    
                    fileToSend = stagingDir;
                    session.filename = folderName; 
                } catch (err: any) {
                    session.status = 'failed';
                    session.error = 'Layout staging failed: ' + err.message;
                    return;
                }`;

// Try to replace normalize newlines/whitespace slightly if needed, but exact match first
if (content.includes(oldLogic)) {
    content = content.replace(oldLogic, newLogic);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Successfully patched main.ts');
} else {
    console.error('Could not find old logic block to replace. Content dump around expected area:');
    // Debug helper
    const idx = content.indexOf('NO ZIP - MULTIPLE FILES');
    if (idx !== -1) {
        console.log(content.substring(idx, idx + 500));
    } else {
        console.log('Could not even find the comment marker.');
    }
    process.exit(1);
}
