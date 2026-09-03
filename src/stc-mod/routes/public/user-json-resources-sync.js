/**
 * Token-protected receiver for user-scoped JSON presets and UI themes.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import sanitize from 'sanitize-filename';
import { getStcConfig, getDataRoot } from '../../config.js';
import { getAllUserHandles } from '../../../users.js';

export const router = express.Router();

const JSON_LIMIT = '30mb';

function syncEnabled() {
    return !!getStcConfig('publicCharactersSync.enabled', false);
}

function expectedToken() {
    return String(getStcConfig('publicCharactersSync.token', '') || '');
}

function requestToken(req) {
    const auth = String(req.headers.authorization || '');
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
    return String(req.headers['x-stc-sync-token'] || req.body?.token || req.query?.token || '');
}

function requireSyncToken(req, res, next) {
    if (!syncEnabled()) return res.status(404).json({ error: 'User JSON resource sync is disabled' });
    const token = expectedToken();
    if (!token) return res.status(503).json({ error: 'User JSON resource sync token is not configured' });
    if (requestToken(req) !== token) return res.status(401).json({ error: 'Invalid sync token' });
    next();
}

function resourceDirectory(kind, handle) {
    const folder = kind === 'preset' ? 'OpenAI Settings' : kind === 'theme' ? 'themes' : '';
    if (!folder) {
        const error = new Error('Unsupported resource kind');
        error.status = 400;
        throw error;
    }
    return path.join(getDataRoot(), handle, folder);
}

function normalizeFileName(value, fallbackName) {
    const raw = path.basename(String(value || fallbackName || 'resource').trim());
    const base = raw.toLowerCase().endsWith('.json') ? raw.slice(0, -5) : raw;
    const safe = sanitize(base).trim();
    if (!safe) {
        const error = new Error('Invalid resource file name');
        error.status = 400;
        throw error;
    }
    return `${safe}.json`;
}

async function writeResourceToUser(payload) {
    const handle = String(payload.targetUserHandle || '').trim();
    if (!handle) {
        const error = new Error('Missing targetUserHandle');
        error.status = 400;
        throw error;
    }

    const handles = await getAllUserHandles();
    if (!handles.includes(handle)) {
        const error = new Error('Target user does not exist');
        error.status = 404;
        throw error;
    }

    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
        const error = new Error('Resource data must be a JSON object');
        error.status = 400;
        throw error;
    }

    const directory = resourceDirectory(String(payload.kind || ''), handle);
    fs.mkdirSync(directory, { recursive: true });
    const fileName = normalizeFileName(payload.fileName, payload.name);
    const filePath = path.join(directory, fileName);
    if (fs.existsSync(filePath) && payload.overwrite !== true) {
        const error = new Error(`Resource already exists: ${fileName}`);
        error.status = 409;
        throw error;
    }

    fs.writeFileSync(filePath, `${JSON.stringify(payload.data, null, 4)}\n`, 'utf8');
    return { handle, kind: payload.kind, fileName };
}

router.get('/sync-health', requireSyncToken, (req, res) => {
    res.json({ success: true, userJsonResourceSync: true });
});

router.post('/sync-to-user', express.json({ limit: JSON_LIMIT }), requireSyncToken, async (req, res) => {
    try {
        const result = await writeResourceToUser(req.body);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});
