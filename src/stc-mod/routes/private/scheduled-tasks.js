/**
 * SillyTavernchat Module - Scheduled Tasks (Admin)
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { requireAdminMiddleware, getAllUserHandles, getUserDirectories } from '../../../users.js';
import { getDataRoot, getStcConfig, setStcConfig } from '../../config.js';

// Simple in-process cron: check every minute if scheduled task should run
let cleanupInterval = null;

function startScheduledCleanup() {
    if (cleanupInterval) return;
    cleanupInterval = setInterval(async () => {
        if (!getStcConfig('scheduledTasks.cleanBackups.enabled', false)) return;
        const lastRun = getStcConfig('scheduledTasks.cleanBackups.lastRun', 0);
        const intervalHours = getStcConfig('scheduledTasks.cleanBackups.intervalHours', 24);
        const now = Date.now();
        if (now - lastRun < intervalHours * 3600 * 1000) return;
        try {
            const handles = await getAllUserHandles();
            let cleaned = 0;
            for (const h of handles) {
                const backupsDir = path.join(getDataRoot(), h, 'backups');
                if (!fs.existsSync(backupsDir)) continue;
                for (const f of fs.readdirSync(backupsDir)) {
                    try { fs.unlinkSync(path.join(backupsDir, f)); cleaned++; } catch {}
                }
            }
            setStcConfig('scheduledTasks.cleanBackups.lastRun', now);
            console.log(`[STC-MOD] Scheduled backup cleanup: removed ${cleaned} files`);
        } catch (e) {
            console.error('[STC-MOD] Scheduled cleanup error:', e.message);
        }
    }, 60 * 1000); // Check every minute
    cleanupInterval.unref();
}

// Auto-start on module load
startScheduledCleanup();

export const router = express.Router();

// Admin: clean backup files for a specific user
router.post('/clean-backups', requireAdminMiddleware, async (req, res) => {
    try {
        const { handle } = req.body;
        const handles = handle ? [handle] : await getAllUserHandles();
        let totalCleaned = 0;
        let totalSize = 0;

        for (const h of handles) {
            const userDir = path.join(getDataRoot(), h);
            const backupsDir = path.join(userDir, 'backups');
            if (fs.existsSync(backupsDir)) {
                const files = fs.readdirSync(backupsDir);
                for (const f of files) {
                    const fp = path.join(backupsDir, f);
                    try {
                        const stat = fs.statSync(fp);
                        totalSize += stat.size;
                        fs.unlinkSync(fp);
                        totalCleaned++;
                    } catch {}
                }
            }
        }

        res.json({
            success: true,
            cleaned: totalCleaned,
            freedBytes: totalSize,
            freedMiB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: get scheduled tasks config
router.get('/config', requireAdminMiddleware, (req, res) => {
    res.json({
        cleanBackups: {
            enabled: getStcConfig('scheduledTasks.cleanBackups.enabled', false),
            intervalHours: getStcConfig('scheduledTasks.cleanBackups.intervalHours', 24),
            lastRun: getStcConfig('scheduledTasks.cleanBackups.lastRun', 0),
        },
    });
});

// Admin: save scheduled tasks config
router.post('/config', requireAdminMiddleware, (req, res) => {
    try {
        const { cleanBackups } = req.body;
        if (cleanBackups) {
            if (cleanBackups.enabled !== undefined) setStcConfig('scheduledTasks.cleanBackups.enabled', !!cleanBackups.enabled);
            if (cleanBackups.intervalHours !== undefined) setStcConfig('scheduledTasks.cleanBackups.intervalHours', Math.max(1, parseInt(cleanBackups.intervalHours) || 24));
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: get storage analysis for all users (paginated)
// Query params: page (1-based, default 1), limit (default 30), search (handle substring), sortBy (name|storage)
router.get('/storage-analysis', requireAdminMiddleware, async (req, res) => {
    try {
        const page   = Math.max(1, parseInt(String(req.query.page  ?? '1')) || 1);
        const limit  = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '30')) || 30));
        const search = String(req.query.search ?? '').toLowerCase().trim();
        const sortBy = String(req.query.sortBy ?? 'name').toLowerCase(); // 'name' or 'storage'

        const allHandles = await getAllUserHandles();
        // Apply search filter on handle name first (cheap, no disk I/O)
        const filtered = search
            ? allHandles.filter(h => h.toLowerCase().includes(search))
            : allHandles;

        /** Recursively sum all file sizes under dirPath */
        function dirSize(dirPath) {
            let total = 0;
            if (!fs.existsSync(dirPath)) return 0;
            try {
                for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
                    const full = path.join(dirPath, entry.name);
                    if (entry.isDirectory()) total += dirSize(full);
                    else if (entry.isFile()) total += fs.statSync(full).size;
                }
            } catch {}
            return total;
        }

        /** Scan a single user handle and return analysis row */
        function analyseUser(handle) {
            const userDir = path.join(getDataRoot(), handle);
            if (!fs.existsSync(userDir)) return null;

            const KNOWN_DIRS = { chats: 'chats', characters: 'characters', backups: 'backups', worlds: 'worlds', themes: 'themes' };
            const categoryBytes = { chats: 0, characters: 0, backups: 0, worlds: 0, themes: 0 };
            for (const [key, dirName] of Object.entries(KNOWN_DIRS)) {
                categoryBytes[key] = dirSize(path.join(userDir, dirName));
            }
            const totalBytes = dirSize(userDir);
            const categorisedBytes = Object.values(categoryBytes).reduce((a, b) => a + b, 0);
            const otherBytes = Math.max(0, totalBytes - categorisedBytes);
            const toMiB = (b) => Math.round(b / 1024 / 1024 * 100) / 100;
            return {
                handle,
                totalBytes,
                totalMiB: toMiB(totalBytes),
                categories: {
                    chats:      toMiB(categoryBytes.chats),
                    characters: toMiB(categoryBytes.characters),
                    backups:    toMiB(categoryBytes.backups),
                    worlds:     toMiB(categoryBytes.worlds),
                    themes:     toMiB(categoryBytes.themes),
                    other:      toMiB(otherBytes),
                },
            };
        }

        // Scan ALL filtered users first (needed for global sorting)
        const allData = /** @type {NonNullable<ReturnType<typeof analyseUser>>[]} */ (
            filtered.map(analyseUser).filter(Boolean)
        );

        // Sort based on sortBy parameter
        if (sortBy === 'storage') {
            allData.sort((a, b) => b.totalBytes - a.totalBytes); // High to low
        } else {
            allData.sort((a, b) => a.handle.localeCompare(b.handle)); // Alphabetical
        }

        // Apply pagination after sorting
        const offset = (page - 1) * limit;
        const pageData = allData.slice(offset, offset + limit);

        res.json({
            total:       allData.length,
            page,
            limit,
            totalPages:  Math.ceil(allData.length / limit),
            data:        pageData,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
