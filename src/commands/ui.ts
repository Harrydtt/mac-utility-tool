import open from 'open';
import { startServer } from '../server/index.js';
import chalk from 'chalk';

export async function uiCommand(options: { port?: string }): Promise<void> {
    const port = options.port ? parseInt(options.port, 10) : 3000;

    console.log(chalk.cyan('Starting Web Dashboard...'));
    console.log(chalk.dim('Press Ctrl+C to stop the server.'));

    const url = startServer(port);

    console.log(chalk.green(`\nDashboard available at: ${chalk.underline(url)}\n`));

    await open(url);

    // Keep process alive
    await new Promise(() => { });
}
