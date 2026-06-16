/**
 * SillyTavernchat Module - Public Characters Sync Receiver
 * Token-protected endpoint used by an external distribution service.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getStcConfig, getStcDataDir } from '../../config.js';

export const router = express.Router();

const JSON_LIMIT = '30mb';

function getCharsDir() {
    const dir = path.join(getStcDataDir(), 'public_characters');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getFilesDir() {
    const dir = path.join(getCharsDir(), 'files');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getCardsDir() {
    const dir = path.join(getCharsDir(), 'cards');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getPreviewsDir() {
    const dir = path.join(getCharsDir(), 'previews');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function loadCharIndex() {
    const f = path.join(getCharsDir(), 'index.json');
    if (!fs.existsSync(f)) return [];
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch { return []; }
}

function saveCharIndex(index) {
    fs.writeFileSync(path.join(getCharsDir(), 'index.json'), JSON.stringify(index, null, 2), 'utf8');
}

function syncEnabled() {
    return !!getStcConfig('publicCharactersSync.enabled', false);
}

function expectedToken() {
    return String(getStcConfig('publicCharactersSync.token', '') || '');
}

function tavernId() {
    return String(getStcConfig('publicCharactersSync.tavernId', '') || '');
}

function requestToken(req) {
    const auth = String(req.headers.authorization || '');
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
    return String(req.headers['x-stc-sync-token'] || req.body?.token || req.query?.token || '');
}

function requireSyncToken(req, res, next) {
    if (!syncEnabled()) return res.status(404).json({ error: 'Public character sync is disabled' });
    const token = expectedToken();
    if (!token) return res.status(503).json({ error: 'Public character sync token is not configured' });
    if (requestToken(req) !== token) return res.status(401).json({ error: 'Invalid sync token' });
    next();
}

function centralLocalId(centralId) {
    const hash = crypto.createHash('sha256').update(String(centralId)).digest('hex').slice(0, 32);
    return `central-${hash}`;
}

function decodeDataUrl(value, allowedMimeTypes) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const match = value.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return Buffer.from(value, 'base64');
    const mime = match[1].toLowerCase();
    if (allowedMimeTypes?.length && !allowedMimeTypes.includes(mime)) {
        throw new Error(`Unsupported data URL type: ${mime}`);
    }
    return Buffer.from(match[2], 'base64');
}

function normalizeCardData(value, fallbackName) {
    if (value && typeof value === 'object') return value;
    if (typeof value === 'string' && value.trim()) return JSON.parse(value);
    return { name: fallbackName || 'character' };
}

router.get('/sync-health', requireSyncToken, (req, res) => {
    res.json({
        success: true,
        tavernId: tavernId() || null,
        publicCharactersSync: true,
    });
});

router.post('/sync', express.json({ limit: JSON_LIMIT }), requireSyncToken, (req, res) => {
    try {
        const centralId = String(req.body.centralId || '').trim();
        if (!centralId) return res.status(400).json({ error: 'Missing centralId' });

        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Missing name' });

        const localId = centralLocalId(centralId);
        const cardFileName = `${localId}.json`;
        const previewFileName = `${localId}.jpg`;
        const sourceFileName = req.body.sourceFileDataUrl ? `${localId}.png` : null;

        const previewBuffer = decodeDataUrl(req.body.previewImageDataUrl, ['image/jpeg']);
        if (!previewBuffer?.length) return res.status(400).json({ error: 'Missing previewImageDataUrl' });
        if (previewBuffer.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Preview image is too large' });

        const cardData = normalizeCardData(req.body.cardData, name);
        fs.writeFileSync(path.join(getCardsDir(), cardFileName), JSON.stringify(cardData, null, 2), 'utf8');
        fs.writeFileSync(path.join(getPreviewsDir(), previewFileName), previewBuffer);

        if (sourceFileName) {
            const sourceBuffer = decodeDataUrl(req.body.sourceFileDataUrl, ['image/png']);
            if (!sourceBuffer?.length) return res.status(400).json({ error: 'Invalid sourceFileDataUrl' });
            if (sourceBuffer.length > 30 * 1024 * 1024) return res.status(400).json({ error: 'Source PNG is too large' });
            fs.writeFileSync(path.join(getFilesDir(), sourceFileName), sourceBuffer);
        }

        const index = loadCharIndex();
        const existingIndex = index.findIndex(c => c.centralId === centralId || c.id === localId);
        const existing = existingIndex >= 0 ? index[existingIndex] : {};
        const now = Date.now();
        const entry = {
            ...existing,
            id: localId,
            centralId,
            source: 'central',
            name,
            description: String(req.body.description || '').trim(),
            category: String(req.body.category || 'general'),
            tags: Array.isArray(req.body.tags) ? req.body.tags.map(String) : [],
            sharedBy: String(req.body.authorId || 'central'),
            sharedByName: String(req.body.authorName || req.body.authorId || '中心分发'),
            createdAt: Number(existing.createdAt || req.body.createdAt || now),
            updatedAt: now,
            downloads: Number(existing.downloads || 0),
            ratings: Array.isArray(existing.ratings) ? existing.ratings : [],
            deleted: false,
            avatar: previewFileName,
            preview: previewFileName,
            cardFile: cardFileName,
            sourceFile: sourceFileName,
            ext: sourceFileName ? 'png' : 'json',
        };

        if (existingIndex >= 0) index[existingIndex] = entry;
        else index.push(entry);
        saveCharIndex(index);

        res.json({ success: true, character: entry });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/sync-delete', express.json({ limit: '1mb' }), requireSyncToken, (req, res) => {
    try {
        const centralId = String(req.body.centralId || '').trim();
        if (!centralId) return res.status(400).json({ error: 'Missing centralId' });

        const localId = centralLocalId(centralId);
        const index = loadCharIndex();
        const entry = index.find(c => c.centralId === centralId || c.id === localId);
        if (!entry) return res.status(404).json({ error: 'Character not found' });

        entry.deleted = true;
        entry.updatedAt = Date.now();
        saveCharIndex(index);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
