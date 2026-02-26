import { BaseScanner } from './base-scanner.js';
import { CATEGORIES, type ScanResult, type ScannerOptions, type CleanableItem } from '../types.js';
import { exists, getSize } from '../utils/index.js';
import { readdir, stat, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

// Extended search paths from Mole
const DEFAULT_SEARCH_PATHS = [
  join(homedir(), 'Projects'),
  join(homedir(), 'Developer'),
  join(homedir(), 'Code'),
  join(homedir(), 'dev'),
  join(homedir(), 'workspace'),
  join(homedir(), 'repos'),
  join(homedir(), 'www'),
  join(homedir(), 'GitHub'),
  join(homedir(), 'Workspace'),
  join(homedir(), 'Repos'),
  join(homedir(), 'Development'),
  join(homedir(), 'Desktop'),
  join(homedir(), 'Documents'),
];

// All artifact types from Mole's project.sh
const ARTIFACT_TARGETS = new Set([
  'node_modules',   // JavaScript/Node.js
  'target',         // Rust, Maven
  'build',          // Gradle, various
  'dist',           // JS builds
  'venv',           // Python
  '.venv',          // Python
  '.gradle',        // Gradle local
  '__pycache__',    // Python
  '.next',          // Next.js
  '.nuxt',          // Nuxt.js
  '.output',        // Nuxt.js
  'vendor',         // PHP Composer
  'obj',            // C# / Unity
  '.turbo',         // Turborepo cache
  '.parcel-cache',  // Parcel bundler
  '.dart_tool',     // Flutter/Dart build cache
]);

// Project indicators - files that indicate a valid project root
const PROJECT_INDICATORS = new Set([
  'package.json',      // Node.js
  'Cargo.toml',        // Rust
  'pom.xml',           // Maven
  'build.gradle',      // Gradle
  'build.gradle.kts',  // Gradle Kotlin
  'requirements.txt',  // Python
  'setup.py',          // Python
  'pyproject.toml',    // Python
  'composer.json',     // PHP
  'pubspec.yaml',      // Flutter/Dart
  '.csproj',           // C#
]);

const DEFAULT_DAYS_OLD = 7; // More aggressive than before (was 30)

export class ProjectArtifactsScanner extends BaseScanner {
  category = CATEGORIES['node-modules'];

  async scan(options?: ScannerOptions): Promise<ScanResult> {
    const items: CleanableItem[] = [];
    const daysOld = options?.daysOld ?? DEFAULT_DAYS_OLD;

    // DEBUG: Check if logger is passed
    console.log('[Scanner] NodeModules options:', { hasLogger: !!options?.logger });

    // Deduplicate search paths to avoid double-scanning on case-insensitive OS (Mac/Win)
    const uniquePaths = new Set<string>();
    const normalizedPaths = new Set<string>();

    for (const p of DEFAULT_SEARCH_PATHS) {
      const normalized = p.toLowerCase();
      if (!normalizedPaths.has(normalized)) {
        normalizedPaths.add(normalized);
        uniquePaths.add(p);
      }
    }

    // Get ignored folders from options (normalized to lowercase for comparison)
    const ignoredFolders = options?.ignoredFolders || [];
    const isPathIgnored = (p: string): boolean => {
      const normalizedPath = p.toLowerCase();
      return ignoredFolders.some(folder =>
        normalizedPath === folder || normalizedPath.startsWith(folder + '/')
      );
    };

    // Parallelize search path scanning
    const tasks = Array.from(uniquePaths).map(async (searchPath) => {
      // IMPORTANT: Skip paths that are in the ignore list
      if (isPathIgnored(searchPath)) {
        console.log(`[Scanner] NodeModules: SKIPPING ${searchPath} (in ignore list)`);
        if (options?.logger) options.logger(`[Scanner] NodeModules: SKIPPING ${searchPath} (ignored)`);
        return [];
      }

      if (await exists(searchPath)) {
        const start = Date.now();
        try {
          const found = await this.findArtifacts(searchPath, daysOld, 5); // Reduced depth from 8 to 5
          const duration = Date.now() - start;
          const msg = `[Scanner] NodeModules: ${searchPath} took ${duration}ms`;
          console.log(msg); // Keep backend log
          if (options?.logger) options.logger(msg); // Send to frontend via IPC
          return found;
        } catch (err) {
          console.error(`[Scanner] NodeModules: ${searchPath} failed:`, err);
          return [];
        }
      }
      return [];
    });

    const results = await Promise.all(tasks);
    items.push(...results.flat());

    // Sort by size (largest first)
    items.sort((a, b) => b.size - a.size);

    return this.createResult(items);
  }

  private async findArtifacts(
    dir: string,
    daysOld: number,
    maxDepth: number,
    currentDepth = 0
  ): Promise<CleanableItem[]> {
    const items: CleanableItem[] = [];

    if (currentDepth > maxDepth) return items;

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Skip hidden directories except our targets
        if (entry.name.startsWith('.') && !ARTIFACT_TARGETS.has(entry.name)) continue;

        const fullPath = join(dir, entry.name);

        if (ARTIFACT_TARGETS.has(entry.name)) {
          // Found an artifact target, check if it's in a valid project
          const parentDir = dir;
          const isValidProject = await this.isProjectDirectory(parentDir);

          try {
            const parentStats = await stat(parentDir);
            const daysSinceModified = (Date.now() - parentStats.mtime.getTime()) / (1000 * 60 * 60 * 24);

            // Check if old enough OR orphaned (no project indicator)
            const isOldEnough = daysSinceModified >= daysOld;
            const isOrphaned = !isValidProject;

            if (isOldEnough || isOrphaned) {
              const size = await getSize(fullPath);
              if (size > 0) { // Only include if has size
                const stats = await stat(fullPath);
                const status = isOrphaned
                  ? 'orphaned'
                  : `${Math.floor(daysSinceModified)}d old`;

                items.push({
                  path: fullPath,
                  size,
                  name: `${this.getProjectName(parentDir)}/${entry.name} (${status})`,
                  isDirectory: true,
                  modifiedAt: stats.mtime,
                });
              }
            }
          } catch {
            // If we can't stat, try to get size anyway for orphaned artifacts
            try {
              const size = await getSize(fullPath);
              if (size > 0) {
                const stats = await stat(fullPath);
                items.push({
                  path: fullPath,
                  size,
                  name: `${this.getProjectName(parentDir)}/${entry.name} (orphaned)`,
                  isDirectory: true,
                  modifiedAt: stats.mtime,
                });
              }
            } catch {
              // Ignore permission errors
            }
          }
          // Don't descend into artifact directories
        } else {
          // Not an artifact, recurse into subdirectory
          const subItems = await this.findArtifacts(fullPath, daysOld, maxDepth, currentDepth + 1);
          items.push(...subItems);
        }
      }
    } catch {
      // Ignore permission errors
    }

    return items;
  }

  private async isProjectDirectory(dir: string): Promise<boolean> {
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (PROJECT_INDICATORS.has(entry)) {
          return true;
        }
        // Check for .csproj files (they have variable names)
        if (entry.endsWith('.csproj')) {
          return true;
        }
      }
    } catch {
      // Ignore errors
    }
    return false;
  }

  private getProjectName(projectPath: string): string {
    const parts = projectPath.split('/');
    return parts[parts.length - 1] || projectPath;
  }
}

// Export with old name for backward compatibility
export { ProjectArtifactsScanner as NodeModulesScanner };
