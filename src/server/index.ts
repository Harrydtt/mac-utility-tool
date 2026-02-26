
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { streamSSE } from 'hono/streaming'
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runAllScans, getAvailableScanners } from '../scanners/index.js';
import { moveToTrash, emptyTrash, addIgnoredPaths, loadConfig, saveConfig, getHistory, saveHistory } from '../utils/index.js';
import { exec } from 'child_process';
import checkDiskSpace from 'check-disk-space';
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = new Hono();

// Serve static files
app.get('/', async (c) => {
    const html = await readFile(join(__dirname, '../ui/index.html'), 'utf-8');
    return c.html(html);
});

app.get('/style.css', async (c) => {
    const css = await readFile(join(__dirname, '../ui/style.css'), 'utf-8');
    return c.text(css, 200, { 'Content-Type': 'text/css' });
});

app.get('/app.js', async (c) => {
    const js = await readFile(join(__dirname, '../ui/app.js'), 'utf-8');
    return c.text(js, 200, { 'Content-Type': 'application/javascript' });
});

// --- V3 APIs ---

app.get('/api/disk-info', async (c) => {
    try {
        const space = await checkDiskSpace('/');
        return c.json({
            total: space.size,
            free: space.free,
            used: space.size - space.free
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

app.get('/api/history', async (c) => {
    const history = await getHistory();
    return c.json(history);
});

app.get('/api/settings', async (c) => {
    const config = await loadConfig();
    return c.json(config);
});

app.post('/api/settings', async (c) => {
    try {
        const body = await c.req.json();
        const config = await loadConfig();
        const newConfig = { ...config, ...body };
        await saveConfig(newConfig);
        return c.json({ success: true });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

app.post('/api/settings/layout', async (c) => {
    try {
        const { categoryOverrides } = await c.req.json();
        const config = await loadConfig();
        config.categoryOverrides = categoryOverrides;
        await saveConfig(config);
        return c.json({ success: true });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

app.get('/api/scanners', (c) => {
    return c.json(getAvailableScanners());
});

// SSE Clients
const clients = new Set<any>();

function broadcast(data: any) {
    const msg = JSON.stringify(data);
    for (const client of clients) {
        client.writeSSE({ data: msg });
    }
}

app.get('/api/scan/events', (c) => {
    return streamSSE(c, async (stream) => {
        console.log('SSE Connected');
        clients.add(stream);

        // Initial message
        await stream.writeSSE({ data: JSON.stringify({ type: 'connected' }) });

        // Keep connection alive
        while (true) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        clients.delete(stream);
    });
});

app.post('/api/scan/start', async (c) => {
    // Run scan in background
    runAllScans(
        { parallel: true },
        (scanner, result) => {
            broadcast({
                type: 'progress',
                id: scanner.category.id,
                totalSize: result.totalSize,
                itemsCount: result.items.length
            });
        }
    ).then(summary => {
        broadcast({ type: 'complete', summary });
    }).catch(err => {
        broadcast({ type: 'error', message: String(err) });
    });

    return c.json({ success: true, message: 'Scan started' });
});


// Clean Actions
app.post('/api/clean', async (c) => {
    try {
        const { items, categories } = await c.req.json<{ items: string[]; categories?: string[] }>();
        if (!items || !Array.isArray(items)) {
            return c.json({ error: 'Invalid items' }, 400);
        }
        // IMPORTANT: Clear cache to get fresh config (deleteMode may have changed)
        const { clearConfigCache } = await import('../utils/config.js');
        clearConfigCache();

        const config = await loadConfig();
        const mode = config.deleteMode || 'trash';
        console.log('[Clean] deleteMode from config:', mode, 'config.deleteMode:', config.deleteMode);
        let cleanedCount = 0;
        let errors: string[] = [];

        if (mode === 'permanent') {
            console.log('[Clean] Using PERMANENT delete (fs.rm)');
            // Permanent Delete
            const { rm } = await import('fs/promises');
            await Promise.all(items.map(async (p) => {
                try {
                    await rm(p, { recursive: true, force: true });
                    cleanedCount++;
                } catch (e: any) {
                    console.error(`Failed to remove ${p}:`, e.message);
                    errors.push(`${e.code || 'ERROR'}: ${p}`);
                }
            }));
        } else {
            // Move to Trash
            const result = await moveToTrash(items);
            if (result.success) {
                cleanedCount = items.length;
            } else {
                errors.push(result.error || 'Failed to move to trash');
                console.error('Trash error:', result.error);
            }
        }

        await saveHistory({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            itemsCount: cleanedCount,
            totalFreed: 0,
            mode: mode === 'permanent' ? 'ui-permanent' : 'ui-trash',
            categories: categories || []
        });

        return c.json({
            success: true,
            count: cleanedCount,
            errors: errors.length > 0 ? errors : undefined,
            partial: cleanedCount < items.length
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

app.post('/api/ignore', async (c) => {
    try {
        const { paths } = await c.req.json<{ paths: string[] }>();
        await addIgnoredPaths(paths);
        return c.json({ success: true });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

app.post('/api/unignore', async (c) => {
    try {
        const { paths } = await c.req.json<{ paths: string[] }>();
        const config = await loadConfig();
        if (config.ignoredPaths) {
            config.ignoredPaths = config.ignoredPaths.filter(p => !paths.includes(p));
            await saveConfig(config);
        }
        return c.json({ success: true });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});


app.post('/api/empty-trash', async (c) => {
    try {
        await emptyTrash();
        return c.json({ success: true });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

app.post('/api/open-trash', async (c) => {
    exec('open ~/.Trash');
    return c.json({ success: true });
});

export function startServer(port = 3000) {
    console.log(`Starting UI server on http://localhost:${port}`);
    serve({
        fetch: app.fetch,
        port
    });
    return `http://localhost:${port}`;
}
