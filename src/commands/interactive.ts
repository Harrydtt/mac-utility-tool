import chalk from 'chalk';
import confirm from '@inquirer/confirm';
import checkbox from '@inquirer/checkbox';
import type { CategoryId, CleanSummary, CleanableItem, ScanResult, SafetyLevel } from '../types.js';
import { runAllScans, getScanner, getAllScanners } from '../scanners/index.js';
import { formatSize, createScanProgress, createCleanProgress, addIgnoredPaths, loadConfig, saveConfig } from '../utils/index.js';

const SAFETY_ICONS: Record<SafetyLevel, string> = {
  safe: chalk.green('●'),
  moderate: chalk.yellow('●'),
  risky: chalk.red('●'),
};

interface InteractiveOptions {
  includeRisky?: boolean;
  noProgress?: boolean;
}

export async function interactiveCommand(options: InteractiveOptions = {}): Promise<CleanSummary | null> {
  console.log();
  console.log(chalk.bold.cyan('🧹 Mac Cleaner CLI'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log();

  // Step 1: Scan
  const showProgress = !options.noProgress && process.stdout.isTTY;
  const scanners = getAllScanners();
  const scanProgress = showProgress ? createScanProgress(scanners.length) : null;

  console.log(chalk.cyan('Scanning your Mac for cleanable files...\n'));

  const summary = await runAllScans({
    parallel: true,
    concurrency: 4,
    onProgress: (completed, _total, scanner) => {
      scanProgress?.update(completed, `Scanning ${scanner.category.name}...`);
    },
  });

  scanProgress?.finish();

  if (summary.totalSize === 0) {
    console.log(chalk.green('✓ Your Mac is already clean! Nothing to remove.\n'));
    return null;
  }

  // Step 2: Show results and filter
  let resultsWithItems = summary.results.filter((r) => r.items.length > 0);

  const riskyResults = resultsWithItems.filter((r) => r.category.safetyLevel === 'risky');
  const safeResults = resultsWithItems.filter((r) => r.category.safetyLevel !== 'risky');

  if (!options.includeRisky && riskyResults.length > 0) {
    const riskySize = riskyResults.reduce((sum, r) => sum + r.totalSize, 0);
    console.log();
    console.log(chalk.yellow('⚠ Hiding risky categories:'));
    for (const result of riskyResults) {
      console.log(chalk.dim(`  ${SAFETY_ICONS.risky} ${result.category.name}: ${formatSize(result.totalSize)}`));
    }
    console.log(chalk.dim(`  Total hidden: ${formatSize(riskySize)}`));
    console.log(chalk.dim('  Run with --risky to include these categories'));
    resultsWithItems = safeResults;
  }

  if (resultsWithItems.length === 0) {
    console.log(chalk.green('\n✓ Nothing safe to clean!\n'));
    return null;
  }

  // Step 3: Show what was found
  console.log();
  console.log(chalk.bold(`Found ${chalk.green(formatSize(summary.totalSize))} that can be cleaned:`));
  console.log();

  // Step 4: Let user select categories
  const selectedItems = await selectItemsInteractively(resultsWithItems, options.includeRisky);

  if (selectedItems.length === 0) {
    console.log(chalk.yellow('\nNo items selected. Nothing to clean.\n'));
    return null;
  }

  const totalToClean = selectedItems.reduce((sum, s) => sum + s.items.reduce((is, i) => is + i.size, 0), 0);
  const totalItems = selectedItems.reduce((sum, s) => sum + s.items.length, 0);

  // Step 5: Confirm
  console.log();
  console.log(chalk.bold('Summary:'));
  console.log(`  Items to delete: ${chalk.yellow(totalItems.toString())}`);
  console.log(`  Space to free: ${chalk.green(formatSize(totalToClean))}`);
  console.log();

  const proceed = await confirm({
    message: `Proceed with cleaning?`,
    default: true,
  });

  if (!proceed) {
    console.log(chalk.yellow('\nCleaning cancelled.\n'));
    return null;
  }

  // Step 6: Clean
  const cleanProgress = showProgress ? createCleanProgress(selectedItems.length) : null;

  const cleanResults: CleanSummary = {
    results: [],
    totalFreedSpace: 0,
    totalCleanedItems: 0,
    totalErrors: 0,
  };

  let cleanedCount = 0;
  for (const { categoryId, items } of selectedItems) {
    const scanner = getScanner(categoryId);
    cleanProgress?.update(cleanedCount, `Cleaning ${scanner.category.name}...`);

    const result = await scanner.clean(items);
    cleanResults.results.push(result);
    cleanResults.totalFreedSpace += result.freedSpace;
    cleanResults.totalCleanedItems += result.cleanedItems;
    cleanResults.totalErrors += result.errors.length;
    cleanedCount++;
  }

  cleanProgress?.finish();

  // Step 7: Show results
  printCleanResults(cleanResults);

  return cleanResults;
}

async function selectItemsInteractively(
  results: ScanResult[],
  _includeRisky = false
): Promise<{ categoryId: CategoryId; items: CleanableItem[] }[]> {
  const choices: any[] = results.map((r) => {
    const safetyIcon = SAFETY_ICONS[r.category.safetyLevel];

    return {
      name: `${safetyIcon} ${r.category.name.padEnd(28)} ${chalk.yellow(formatSize(r.totalSize).padStart(10))} ${chalk.dim(`(${r.items.length} items)`)}`,
      value: r.category.id,
      checked: false,
    };
  });

  const VIEW_IGNORED_ID = 'view-ignored-files';

  // Add "View Ignored Files" option
  choices.push({
    name: ` ${chalk.cyan('👁  View Ignored Files (Blacklist)')}`.padEnd(50),
    value: VIEW_IGNORED_ID,
    checked: false,
  });

  const selectedCategories = await checkbox<string>({
    message: 'Select categories to clean (space to toggle, enter to confirm):',
    choices: choices,
    pageSize: 15,
    theme: {
      style: {
        answer: (answers: unknown[]) => chalk.dim(`(${answers.length} categories selected)`),
      },
    },
  });

  if (selectedCategories.includes(VIEW_IGNORED_ID)) {
    await manageIgnoredFiles();
    console.log(chalk.yellow('\n(Please run scan again if you un-ignored files to see them in the list)\n'));

    const index = selectedCategories.indexOf(VIEW_IGNORED_ID);
    if (index > -1) {
      selectedCategories.splice(index, 1);
    }
  }

  const selectedResults = results.filter((r) => selectedCategories.includes(r.category.id));
  const selectedItems: { categoryId: CategoryId; items: CleanableItem[] }[] = [];

  for (const result of selectedResults) {
    const isRisky = result.category.safetyLevel === 'risky';
    // Always check if we should show selection, either because it's required or requested
    let showSelection = isRisky || result.category.id === 'large-files' || result.category.id === 'ios-backups';

    // If not naturally required, ask the user if they want to see files
    if (!showSelection && result.items.length > 0) {
      const shouldReview = await confirm({
        message: `Review ${result.items.length} files for ${result.category.name}?`,
        default: false,
      });
      showSelection = shouldReview;
    }

    if (showSelection) {
      if (isRisky && result.category.safetyNote) {
        console.log();
        console.log(chalk.red(`⚠ WARNING: ${result.category.safetyNote}`));
      }

      // Sort items by size descending
      const sortedItems = [...result.items].sort((a, b) => b.size - a.size);

      // Smart Grouping Logic
      const MAX_INDIVIDUAL_ITEMS = 20;
      const MIN_SIZE_FOR_INDIVIDUAL = 1024 * 1024; // 1MB

      const mainItems = [];
      const smallItems = [];

      for (const item of sortedItems) {
        if (mainItems.length < MAX_INDIVIDUAL_ITEMS || item.size > MIN_SIZE_FOR_INDIVIDUAL) {
          mainItems.push(item);
        } else {
          smallItems.push(item);
        }
      }

      const itemChoices = mainItems.map((item) => {
        // Truncate name and path for better display
        const name = item.name.length > 30 ? item.name.substring(0, 27) + '...' : item.name;
        // Simple heuristic for path: last 2 parts
        const pathParts = item.path.split('/');
        const pathHint = pathParts.length > 2 ? '.../' + pathParts.slice(-2).join('/') : item.path;
        const pathDisplay = pathHint.length > 40 ? pathHint.substring(0, 37) + '...' : pathHint;

        return {
          name: `${name.padEnd(32)} ${chalk.yellow(formatSize(item.size).padStart(9))}  ${chalk.dim(pathDisplay)}`,
          value: item.path,
          checked: true,
        };
      });

      if (smallItems.length > 0) {
        const totalSmallSize = smallItems.reduce((sum, i) => sum + i.size, 0);
        // We use a special value prefix to identify this group
        const groupValue = `__GROUP_SMALL_FILES__:${result.category.id}`;

        itemChoices.push({
          name: `${chalk.italic(`${smallItems.length} other small files`)}`.padEnd(32) + ` ${chalk.yellow(formatSize(totalSmallSize).padStart(9))}`,
          value: groupValue,
          checked: true,
        });
      }

      // Risky items unchecked by default
      if (isRisky && result.category.id !== 'large-files') {
        itemChoices.forEach(c => c.checked = false);
      }

      const selectedValues = await checkbox<string>({
        message: `Select items from ${result.category.name}:`,
        choices: itemChoices,
        pageSize: 15, // Increased page size for better view
        theme: {
          style: {
            answer: (answers: unknown[]) => chalk.dim(`(${answers.length} items selected)`),
          },
        },
      });

      // Process selection
      const selectedPathsSet = new Set(selectedValues);

      // Add individual main items
      const selectedMainItems = mainItems.filter(i => selectedPathsSet.has(i.path));

      // Calculate kept items (candidates for ignoring)
      // Only consider mainItems for ignoring to avoid complexity with grouped small files for now
      // or we can filter all result.items
      const keptMainItems = mainItems.filter(i => !selectedPathsSet.has(i.path));

      if (keptMainItems.length > 0) {
        // Ask if user wants to ignore any of these
        // But wait, user just unchecked them to KEEP them.
        // We typically ask "Do you want to ignore these in future?"
        // Ideally this should be a separate prompt after selection or an "Action" choice.
        // Given CLI flow, maybe ask after this category is done?
        // Let's print a small prompt.
        // "You kept X files. Ignore them in future scans? (Y/n)"

        // However, not everyone wants to be asked this every time. 
        // Maybe only if keptMainItems > 0.

        // NOTE: Doing this inside the loop might be annoying if there are many categories.
        // But it gives per-category control.

        // Let's leave it as a prompt.
        // UX: "Would you like to permanently ignore any of the 5 files you kept?"

        const shouldIgnore = await confirm({
          message: `You kept ${keptMainItems.length} files. Permanently ignore any of them in future scans?`,
          default: false,
        });

        if (shouldIgnore) {
          const ignoreChoices = keptMainItems.map(item => ({
            name: `${item.name.substring(0, 40).padEnd(40)} ${chalk.yellow(formatSize(item.size).padStart(10))}`,
            value: item.path,
            checked: false
          }));

          const pathsToIgnore = await checkbox<string>({
            message: 'Select files to permanently ignore:',
            choices: ignoreChoices,
            pageSize: 10,
            theme: {
              style: {
                answer: (answers: unknown[]) => chalk.dim(`(${answers.length} files ignored)`),
              },
            },
          });

          if (pathsToIgnore.length > 0) {
            await addIgnoredPaths(pathsToIgnore);
            console.log(chalk.green(`  ✓ Added ${pathsToIgnore.length} files to ignore list.`));
          }
        }
      }

      // Add small items if group is selected
      let selectedSmallItems: CleanableItem[] = [];
      const groupValue = `__GROUP_SMALL_FILES__:${result.category.id}`;
      if (selectedPathsSet.has(groupValue)) {
        selectedSmallItems = smallItems;
      }

      const finalSelectedItems = [...selectedMainItems, ...selectedSmallItems];

      if (finalSelectedItems.length > 0) {
        selectedItems.push({
          categoryId: result.category.id,
          items: finalSelectedItems,
        });
      }
    } else {
      selectedItems.push({
        categoryId: result.category.id,
        items: result.items,
      });
    }
  }

  return selectedItems;
}

function printCleanResults(summary: CleanSummary): void {
  console.log();
  console.log(chalk.bold.green('✓ Cleaning Complete!'));
  console.log(chalk.dim('─'.repeat(50)));

  for (const result of summary.results) {
    if (result.cleanedItems > 0) {
      console.log(
        `  ${result.category.name.padEnd(30)} ${chalk.green('✓')} ${formatSize(result.freedSpace)} freed`
      );
    }
    for (const error of result.errors) {
      console.log(`  ${result.category.name.padEnd(30)} ${chalk.red('✗')} ${error}`);
    }
  }

  console.log();
  console.log(chalk.dim('─'.repeat(50)));
  console.log(chalk.bold(`🎉 Freed ${chalk.green(formatSize(summary.totalFreedSpace))} of disk space!`));
  console.log(chalk.dim(`   Cleaned ${summary.totalCleanedItems} items`));

  if (summary.totalErrors > 0) {
    console.log(chalk.red(`   Errors: ${summary.totalErrors}`));
  }

  console.log();
}

async function manageIgnoredFiles(): Promise<void> {
  const config = await loadConfig();
  const ignoredPaths = config.ignoredPaths || [];

  if (ignoredPaths.length === 0) {
    console.log(chalk.yellow('No files are currently ignored (blacklisted).'));
    await confirm({ message: 'Press Enter to continue...' });
    return;
  }

  const choices = ignoredPaths.map(p => ({
    name: p,
    value: p,
    checked: false
  }));

  console.log(chalk.cyan('\nManage Ignored Files (Blacklist)'));
  console.log(chalk.dim('Select files to remove from the ignore list (they will appear in future scans).'));

  const pathsToRemove = await checkbox<string>({
    message: 'Select files to UN-IGNORE:',
    choices: choices,
    pageSize: 20,
    theme: {
      style: {
        answer: (answers: unknown[]) => chalk.dim(`(${answers.length} files selected to un-ignore)`),
      },
    },
  });

  if (pathsToRemove.length > 0) {
    const newIgnoredPaths = ignoredPaths.filter(p => !pathsToRemove.includes(p));
    config.ignoredPaths = newIgnoredPaths;
    await saveConfig(config);
    console.log(chalk.green(`\n✓ Un-ignored ${pathsToRemove.length} files. Run scan again to see them.`));
  } else {
    console.log(chalk.dim('\nNo changes made.'));
  }
}

