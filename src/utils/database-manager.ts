import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import * as https from 'https';

const DATABASE_DIR = join(homedir(), '.maccleaner', 'databases');
const MANIFEST_PATH = join(DATABASE_DIR, 'manifest.json');

// GitHub URLs for database sources - using GitHub API to get malware names
const OBJECTIVE_SEE_API_URL = 'https://api.github.com/repos/objective-see/Malware/contents';
const MALWAREBYTES_YARA_BASE = 'https://raw.githubusercontent.com/Yara-Rules/rules/master/malware/';

// Existing YARA rule files from Yara-Rules repo (verified to exist)
const YARA_RULES = [
    '000_common_rules.yar',
    'APT_APT1.yar',
    'APT_APT10.yar'
];

interface DatabaseManifest {
    version: string;
    lastUpdate: string;
    objectiveSee: {
        downloaded: boolean;
        path: string;
        count: number;
    };
    malwareBytes: {
        downloaded: boolean;
        path: string;
        count: number;
    };
}

// Download helper with proper headers for GitHub API
async function downloadFile(url: string, isApi: boolean = false): Promise<string> {
    return new Promise((resolve, reject) => {
        const options: https.RequestOptions = {
            headers: {
                'User-Agent': 'MacCleaner-App',
                ...(isApi && { 'Accept': 'application/vnd.github.v3+json' })
            }
        };

        https.get(url, options, (res) => {
            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302) {
                const redirectUrl = res.headers.location;
                if (redirectUrl) {
                    downloadFile(redirectUrl, isApi).then(resolve).catch(reject);
                    return;
                }
            }

            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                return;
            }

            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// Ensure database directory exists
async function ensureDatabaseDir(): Promise<void> {
    try {
        await fs.access(DATABASE_DIR);
    } catch {
        await fs.mkdir(DATABASE_DIR, { recursive: true });
    }
}

// Download Objective-See malware signatures from GitHub API
export async function downloadObjectiveSee(): Promise<{ success: boolean; count: number; error?: string }> {
    try {
        console.log('[DatabaseManager] Downloading Objective-See malware list from GitHub API...');
        const data = await downloadFile(OBJECTIVE_SEE_API_URL, true);

        // Parse GitHub API response
        const files = JSON.parse(data);
        if (!Array.isArray(files)) {
            throw new Error('Invalid API response');
        }

        // Extract malware names from zip file names
        const malwareNames = files
            .filter((f: any) => f.name && f.name.endsWith('.zip'))
            .map((f: any) => f.name.replace('.zip', ''));

        const signatures = malwareNames.map((name: string) => ({
            name: name,
            source: 'objective-see',
            type: 'macos-malware'
        }));

        await ensureDatabaseDir();
        const filePath = join(DATABASE_DIR, 'objective-see.json');
        await fs.writeFile(filePath, JSON.stringify(signatures, null, 2), 'utf-8');

        console.log(`[DatabaseManager] Downloaded ${signatures.length} Objective-See signatures`);
        return { success: true, count: signatures.length };
    } catch (error: any) {
        console.error('[DatabaseManager] Failed to download Objective-See:', error);
        return { success: false, count: 0, error: error.message };
    }
}

// Download MalwareBytes YARA rules
export async function downloadMalwareBytes(): Promise<{ success: boolean; count: number; error?: string }> {
    try {
        console.log('[DatabaseManager] Downloading MalwareBytes YARA rules...');

        await ensureDatabaseDir();
        const yaraDir = join(DATABASE_DIR, 'malwarebytes');

        try {
            await fs.access(yaraDir);
        } catch {
            await fs.mkdir(yaraDir, { recursive: true });
        }

        let totalRules = 0;
        for (const ruleFile of YARA_RULES) {
            try {
                const url = MALWAREBYTES_YARA_BASE + ruleFile;
                const data = await downloadFile(url);
                const filePath = join(yaraDir, ruleFile);
                await fs.writeFile(filePath, data, 'utf-8');
                console.log(`[DatabaseManager] Downloaded ${ruleFile}`);
                totalRules++;
            } catch (err) {
                console.warn(`[DatabaseManager] Skipped ${ruleFile}:`, err);
            }
        }

        console.log(`[DatabaseManager] Downloaded ${totalRules} YARA rule files`);
        return { success: totalRules > 0, count: totalRules };
    } catch (error: any) {
        console.error('[DatabaseManager] Failed to download MalwareBytes:', error);
        return { success: false, count: 0, error: error.message };
    }
}

// Download all databases
export async function downloadAllDatabases(progressCallback?: (status: string) => void): Promise<{ success: boolean; errors?: string[] }> {
    console.log('[DatabaseManager] Starting database download...');
    const errors: string[] = [];

    progressCallback?.('Downloading Objective-See database...');
    const objResult = await downloadObjectiveSee();
    if (!objResult.success) {
        errors.push(`Objective-See: ${objResult.error}`);
    }

    progressCallback?.('Downloading MalwareBytes YARA rules...');
    const mbResult = await downloadMalwareBytes();
    if (!mbResult.success) {
        errors.push(`MalwareBytes: ${mbResult.error}`);
    }

    // Save manifest
    const manifest: DatabaseManifest = {
        version: '1.0.0',
        lastUpdate: new Date().toISOString(),
        objectiveSee: {
            downloaded: objResult.success,
            path: join(DATABASE_DIR, 'objective-see.json'),
            count: objResult.count
        },
        malwareBytes: {
            downloaded: mbResult.success,
            path: join(DATABASE_DIR, 'malwarebytes'),
            count: mbResult.count
        }
    };

    await ensureDatabaseDir();
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');

    const success = objResult.success && mbResult.success;
    progressCallback?.(success ? 'Download complete!' : 'Download completed with errors');

    return { success, errors: errors.length > 0 ? errors : undefined };
}

// Check if databases are downloaded AND VALID (integrity check)
export async function checkDatabaseStatus(): Promise<{
    downloaded: boolean;
    lastUpdate?: string;
    objectiveSee?: 'valid' | 'invalid' | 'missing';
    malwareBytes?: 'valid' | 'invalid' | 'missing';
}> {
    try {
        let objStatus: 'valid' | 'invalid' | 'missing' = 'missing';
        let mbStatus: 'valid' | 'invalid' | 'missing' = 'missing';

        // Check Objective-See database
        const objPath = join(DATABASE_DIR, 'objective-see.json');
        try {
            const data = await fs.readFile(objPath, 'utf-8');
            const json = JSON.parse(data);
            // Valid if it's an array with at least 50 entries (real DB has 200+)
            if (Array.isArray(json) && json.length >= 50) {
                objStatus = 'valid';
            } else {
                objStatus = 'invalid';
            }
        } catch {
            objStatus = 'missing';
        }

        // Check MalwareBytes YARA rules
        const mbPath = join(DATABASE_DIR, 'malwarebytes');
        try {
            const files = await fs.readdir(mbPath);
            const yarFiles = files.filter(f => f.endsWith('.yar'));
            // Valid if at least 2 .yar files exist
            if (yarFiles.length >= 2) {
                // Check at least one file has content > 1KB (not empty/failed)
                let hasValidFile = false;
                for (const yar of yarFiles) {
                    const stat = await fs.stat(join(mbPath, yar));
                    if (stat.size > 1000) {
                        hasValidFile = true;
                        break;
                    }
                }
                mbStatus = hasValidFile ? 'valid' : 'invalid';
            } else {
                mbStatus = 'invalid';
            }
        } catch {
            mbStatus = 'missing';
        }

        // Read manifest for lastUpdate
        let lastUpdate: string | undefined;
        try {
            const manifestData = await fs.readFile(MANIFEST_PATH, 'utf-8');
            const manifest: DatabaseManifest = JSON.parse(manifestData);
            lastUpdate = manifest.lastUpdate;
        } catch { }

        const downloaded = objStatus === 'valid' && mbStatus === 'valid';
        return { downloaded, lastUpdate, objectiveSee: objStatus, malwareBytes: mbStatus };
    } catch {
        return { downloaded: false, objectiveSee: 'missing', malwareBytes: 'missing' };
    }
}

// Load Objective-See signatures
export async function loadObjectiveSee(): Promise<any[]> {
    try {
        const filePath = join(DATABASE_DIR, 'objective-see.json');
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error('[DatabaseManager] Failed to load Objective-See:', error);
        return [];
    }
}

// Load MalwareBytes YARA rules
export async function loadMalwareBytes(): Promise<string[]> {
    try {
        const yaraDir = join(DATABASE_DIR, 'malwarebytes');
        const files = await fs.readdir(yaraDir);
        const rules: string[] = [];

        for (const file of files) {
            if (file.endsWith('.yar')) {
                const filePath = join(yaraDir, file);
                const data = await fs.readFile(filePath, 'utf-8');
                rules.push(data);
            }
        }

        return rules;
    } catch (error) {
        console.error('[DatabaseManager] Failed to load MalwareBytes:', error);
        return [];
    }
}
