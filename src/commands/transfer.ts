import path from 'path';
import fs from 'fs';
import https from 'https';
import { spawn, exec } from 'child_process';
import os from 'os';
import chalk from 'chalk';
import open from 'open';
import confirm from '@inquirer/confirm';
import ora from 'ora';

// Interface for GitHub Release Asset
interface GitHubAsset {
    name: string;
    browser_download_url: string;
}

interface GitHubRelease {
    tag_name: string;
    assets: GitHubAsset[];
}

const REPO_OWNER = 'tonyantony300';
const REPO_NAME = 'alt-sendme';
const APP_NAME = 'AltSendme.app'; // Mac app bundle name
const STORAGE_DIR = path.join(os.homedir(), '.mac-cleaner', 'extensions'); // Store external apps here
const LOCAL_APP_PATH = path.join(STORAGE_DIR, APP_NAME);

/**
 * Ensures the storage directory exists.
 */
function ensureStorageDir() {
    if (!fs.existsSync(STORAGE_DIR)) {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
}

/**
 * Fetches the latest release info from GitHub.
 */
async function getLatestRelease(): Promise<GitHubRelease> {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
            headers: { 'User-Agent': 'Mac-Cleaner-CLI' }
        };

        https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Failed to parse GitHub response'));
                    }
                } else {
                    reject(new Error(`GitHub API returned status code: ${res.statusCode}`));
                }
            });
        }).on('error', (err) => reject(err));
    });
}

/**
 * Downloads a file from a URL to a local path.
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                downloadFile(response.headers.location!, destPath).then(resolve).catch(reject);
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => { }); // Delete the file async
            reject(err);
        });
    });
}

/**
 * Extracts a tar.gz file.
 */
async function extractTarGz(tarPath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // Use system tar command
        exec(`tar -xzf "${tarPath}" -C "${destDir}"`, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

/**
 * Command to launch or update the file transfer tool.
 */
export async function transferFilesCommand(options: { update?: boolean } = {}): Promise<void> {
    ensureStorageDir();

    console.log();
    console.log(chalk.bold.blue('🚀 Transfer Files (Powered by AltSendme)'));
    console.log(chalk.dim('   Secure P2P file transfer without cloud servers.'));
    console.log(chalk.dim('   Logic: Uses Tickets, QUIC, and Iroh for direct connection.'));
    console.log();

    const appExists = fs.existsSync(LOCAL_APP_PATH);
    let shouldUpdate = options.update;
    const spinner = ora('Checking status...').start();

    try {
        if (!appExists) {
            spinner.text = 'Transfer tool not found. Checking for download...';
            shouldUpdate = true;
        } else if (options.update) {
            spinner.text = 'Checking for updates...';
        } else {
            spinner.succeed('Tool ready.');
        }

        if (shouldUpdate) {
            spinner.text = 'Fetching latest release info from GitHub...';
            const release = await getLatestRelease();

            // Look for tar.gz asset for universal or correct arch
            const tarAsset = release.assets.find(a => a.name.includes('.tar.gz') && a.name.includes('AltSendme'));

            if (!tarAsset) {
                spinner.fail('Could not find a suitable download asset for macOS.');
                return;
            }

            // If app exists and we didn't force update, maybe ask? (But here we assume logic handles it)
            if (appExists && !options.update) {
                // If we implemented version check we would compare release.tag_name vs local
                // For now, only update if requested or missing.
            }

            spinner.text = `Downloading ${release.tag_name}...`;
            const downloadPath = path.join(STORAGE_DIR, 'update.tar.gz');

            await downloadFile(tarAsset.browser_download_url, downloadPath);

            spinner.text = 'Extracting update...';

            // Clean old app if exists
            if (fs.existsSync(LOCAL_APP_PATH)) {
                fs.rmSync(LOCAL_APP_PATH, { recursive: true, force: true });
            }

            await extractTarGz(downloadPath, STORAGE_DIR);

            // Cleanup zip
            if (fs.existsSync(downloadPath)) {
                fs.unlinkSync(downloadPath);
            }

            spinner.succeed(`Update complete! (${release.tag_name})`);
        }
    } catch (error: any) {
        spinner.fail(`Error: ${error.message}`);
        console.error(chalk.red(error));
        if (!appExists) return;
        console.log(chalk.yellow('Attempting to launch existing version...'));
    }

    // Launch the App
    if (fs.existsSync(LOCAL_APP_PATH)) {
        console.log(chalk.green('\n✓ Launching Transfer Files...'));
        try {
            await open(LOCAL_APP_PATH);
            console.log(chalk.dim('   The application window should appear shortly.'));
            console.log(chalk.dim('   (It operates independently as a GUI app)'));
        } catch (error) {
            console.error(chalk.red('Failed to launch application:'), error);
        }
    } else {
        console.error(chalk.red('\nError: Application not found. Please run with --update to install.'));
    }
}
