/**
 * SillyTavernchat Module - Storage Quota Enforcement Middleware
 *
 * Blocks write operations when a user's storage usage exceeds their limit.
 * Registered BEFORE official routes in setupPublicRoutes so it intercepts first.
 *
 * Returns HTTP 507 Insufficient Storage with JSON error body so the frontend
 * can catch it and show a themed prompt.
 */
import { canUserWrite, isStorageLimitEnabled, getUserStorageInfo } from '../services/storage-quota.js';

/**
 * API paths (relative to their router prefix) that are considered write operations.
 * Format: { prefix, paths }
 *   prefix – the app.use() prefix, e.g. '/api/chats'
 *   paths  – POST sub-paths under that prefix that should be blocked
 *            (use '*' to block all POSTs on that prefix)
 */
const BLOCKED_WRITE_ROUTES = [
    // ── Chat data ──────────────────────────────────────────────
    { prefix: '/api/chats', paths: ['/save', '/group/save', '/import', '/group/import'] },

    // ── Characters ─────────────────────────────────────────────
    { prefix: '/api/characters', paths: ['/create', '/import', '/edit-avatar'] },

    // ── World info ─────────────────────────────────────────────
    { prefix: '/api/worldinfo', paths: ['/edit'] },

    // ── File uploads ───────────────────────────────────────────
    { prefix: '/api/files', paths: ['*'] },
    { prefix: '/api/images', paths: ['*'] },
    { prefix: '/api/sprites', paths: ['*'] },
    { prefix: '/api/backgrounds', paths: ['*'] },
];

/**
 * Build a flat set of exact blocked paths for fast lookup.
 * '*' under a prefix means ALL POST requests to that prefix are blocked.
 */
function buildBlockSet() {
    /** @type {Set<string>} exact paths */
    const exact = new Set();
    /** @type {Set<string>} wildcard prefixes (block all under) */
    const wild  = new Set();

    for (const { prefix, paths } of BLOCKED_WRITE_ROUTES) {
        for (const p of paths) {
            if (p === '*') {
                wild.add(prefix.replace(/\/$/, ''));
            } else {
                exact.add((prefix + p).replace(/\/+/g, '/'));
            }
        }
    }
    return { exact, wild };
}

const { exact: EXACT_BLOCKED, wild: WILD_BLOCKED } = buildBlockSet();

/**
 * Check if a request path is a blocked write operation.
 * @param {string} method  HTTP method
 * @param {string} path    req.path (full, e.g. /api/chats/save)
 * @returns {boolean}
 */
function isBlockedWrite(method, path) {
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') return false;

    const normalised = path.replace(/\/+/g, '/').replace(/\/$/, '');

    // Exact match
    if (EXACT_BLOCKED.has(normalised)) return true;

    // Wildcard prefix match
    for (const prefix of WILD_BLOCKED) {
        if (normalised === prefix || normalised.startsWith(prefix + '/')) return true;
    }

    return false;
}

/**
 * Express middleware factory.
 * Registers a single middleware on `app` that checks every relevant write request.
 * @param {import('express').Express} app
 */
export function registerStorageEnforceMiddleware(app) {
    app.use((req, res, next) => {
        // Feature gate: only enforce when storage limit is enabled
        if (!isStorageLimitEnabled()) return next();

        // Only check authenticated users
        const handle = req.session?.handle || req.user?.profile?.handle;
        if (!handle) return next();

        // Only check blocked write paths
        if (!isBlockedWrite(req.method, req.path)) return next();

        // Check quota
        if (!canUserWrite(handle)) {
            const info = getUserStorageInfo(handle);
            return res.status(507).json({
                error: true,
                code: 'STORAGE_QUOTA_EXCEEDED',
                message: `存储空间已满（已用 ${info.usedMiB} MiB / 上限 ${info.limitMiB} MiB），无法执行写入操作。请清理数据或联系管理员扩容。`,
                usedMiB: info.usedMiB,
                limitMiB: info.limitMiB,
                percent: info.percent,
            });
        }

        next();
    });

    console.log('[STC-MOD] Storage quota enforcement middleware registered.');
}
