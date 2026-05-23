/**
 * SillyTavernchat Module - Public Characters Library
 * Share, browse, rate, and import character cards.
 * Uses global multer (field: avatar) from server-main.js.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sanitize from 'sanitize-filename';
import { getStcDataDir } from '../../config.js';
import { getUserDirectories } from '../../../users.js';

export const router = express.Router();

/* ── Directory helpers ── */

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

function getCommentsDir() {
    const dir = path.join(getCharsDir(), 'comments');
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

function savePreviewImage(dataUrl, fileName) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg;base64,')) {
        throw new Error('请上传 JPG 展示图');
    }

    const buffer = Buffer.from(dataUrl.slice('data:image/jpeg;base64,'.length), 'base64');
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
        throw new Error('展示图大小无效或超过 8MB');
    }

    fs.writeFileSync(path.join(getPreviewsDir(), fileName), buffer);
}

function getFallbackAvatarPath() {
    return path.resolve(process.cwd(), 'public', 'img', 'ai4.png');
}

function getPrivateSourcePath(entry) {
    const source = entry?.sourceFile || entry?.avatar;
    if (!source) return null;
    const filesDir = path.resolve(getFilesDir());
    const filePath = path.resolve(filesDir, source);
    return filePath.startsWith(filesDir) ? filePath : null;
}

/* ── List ── */

router.get('/list', (req, res) => {
    const { category, search, page = 1, limit = 200 } = req.query;
    let chars = loadCharIndex().filter(c => !c.deleted);
    if (category) chars = chars.filter(c => c.category === String(category));
    if (search) {
        const q = String(search).toLowerCase();
        chars = chars.filter(c =>
            c.name?.toLowerCase().includes(q) ||
            c.description?.toLowerCase().includes(q) ||
            c.tags?.some(/** @param {string} t */ t => t.toLowerCase().includes(q)),
        );
    }
    chars.sort((a, b) => b.createdAt - a.createdAt);
    const pageNum = Math.max(1, parseInt(String(page)) || 1);
    const limitNum = Math.max(1, parseInt(String(limit)) || 200);
    const start = (pageNum - 1) * limitNum;
    res.json({ characters: chars.slice(start, start + limitNum), total: chars.length });
});

/* ── Upload (uses global multer, field = "avatar") ── */

router.post('/share', (req, res) => {
    (async () => {
        try {
            const file = req.file;
            if (!file) return res.status(400).json({ error: '请选择角色卡文件' });

            const name = String(req.body.name || '').trim();
            if (!name) {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                return res.status(400).json({ error: '请输入角色名称' });
            }

            // Determine file extension
            let ext = (String(req.body.file_type || '')).toLowerCase();
            if (!ext) {
                const mime = (file.mimetype || '').toLowerCase();
                if (mime.includes('png')) ext = 'png';
                else if (mime.includes('json')) ext = 'json';
                else if (mime.includes('yaml') || mime.includes('yml')) ext = 'yaml';
            }
            if (!ext) {
                const orig = file.originalname || '';
                ext = orig.split('.').pop()?.toLowerCase() || 'json';
            }
            if (!['png', 'json', 'yaml', 'yml'].includes(ext)) {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                return res.status(400).json({ error: '不支持的文件格式（支持 PNG / JSON / YAML）' });
            }

            // Parse character data for metadata
            let characterData = {};
            if (ext === 'json') {
                characterData = JSON.parse(fs.readFileSync(file.path, 'utf8'));
            } else if (ext === 'yaml' || ext === 'yml') {
                const yaml = (await import('js-yaml'));
                characterData = yaml.load(fs.readFileSync(file.path, 'utf8')) || {};
            } else if (ext === 'png') {
            const { read } = await import('../../../character-card-parser.js');
            try { characterData = JSON.parse(read(fs.readFileSync(file.path))); }
                catch { /* no embedded data, that's OK */ }
            }

            const id = crypto.randomUUID();
            const cardFileName = `${id}.json`;
            const previewFileName = `${id}.jpg`;
            const sourceFileName = ext === 'png' ? `${id}.png` : null;

            savePreviewImage(req.body.preview_image_data_url, previewFileName);
            fs.writeFileSync(path.join(getCardsDir(), cardFileName), JSON.stringify(characterData || {}, null, 2), 'utf8');

            if (sourceFileName) {
                fs.renameSync(file.path, path.join(getFilesDir(), sourceFileName));
            } else if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }

            // Parse tags
            let tags = [];
            try { tags = JSON.parse(req.body.tags || '[]'); }
            catch { tags = String(req.body.tags || '').split(',').map(t => t.trim()).filter(Boolean); }

            const entry = {
                id,
                name,
                description: String(req.body.description || '').trim(),
                category: String(req.body.category || 'general'),
                tags,
                sharedBy: req.user.profile.handle,
                sharedByName: req.user.profile.name,
                createdAt: Date.now(),
                downloads: 0,
                ratings: [],
                deleted: false,
                avatar: previewFileName,
                preview: previewFileName,
                cardFile: cardFileName,
                sourceFile: sourceFileName,
                ext,
            };

            const index = loadCharIndex();
            index.push(entry);
            saveCharIndex(index);

            res.json({ success: true, character: entry });
        } catch (error) {
            if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            res.status(500).json({ error: error.message });
        }
    })();
});

/* ── Serve avatar (serves the stored PNG/JSON file as an image) ── */

router.get('/avatar/:id', (req, res) => {
    const index = loadCharIndex();
    const entry = index.find(c => c.id === req.params.id && !c.deleted);
    if (!entry) return res.sendStatus(404);

    if (entry.preview) {
        const previewsDir = path.resolve(getPreviewsDir());
        const previewPath = path.resolve(previewsDir, entry.preview);
        if (previewPath.startsWith(previewsDir) && fs.existsSync(previewPath)) {
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
            return res.sendFile(previewPath);
        }
    }

    const fallback = getFallbackAvatarPath();
    if (!fs.existsSync(fallback)) return res.sendStatus(404);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    return res.sendFile(fallback);
});

/* ── Import into user's character library ── */

router.post('/import/:id', (req, res) => {
    (async () => {
        try {
            const index = loadCharIndex();
            const entry = index.find(c => c.id === req.params.id && !c.deleted);
            if (!entry) return res.status(404).json({ error: '角色卡不存在' });

            const filePath = getPrivateSourcePath(entry);
            if (!entry.cardFile && (!filePath || !fs.existsSync(filePath))) {
                return res.status(404).json({ error: '角色卡文件不存在' });
            }

            const handle = req.user.profile.handle;
            const userDirs = getUserDirectories(handle);

            if (!fs.existsSync(userDirs.characters)) {
                fs.mkdirSync(userDirs.characters, { recursive: true });
            }

            const { write, read } = await import('../../../character-card-parser.js');
            const ext = (entry.ext || '').toLowerCase();

            let jsonData;
            let avatarBuffer;

            if (entry.cardFile) {
                const cardsDir = path.resolve(getCardsDir());
                const cardPath = path.resolve(cardsDir, entry.cardFile);
                if (!cardPath.startsWith(cardsDir) || !fs.existsSync(cardPath)) {
                    return res.status(404).json({ error: '角色卡数据不存在' });
                }

                jsonData = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
                if (filePath && fs.existsSync(filePath) && path.extname(filePath).toLowerCase() === '.png') {
                    avatarBuffer = fs.readFileSync(filePath);
                } else {
                    const fallback = getFallbackAvatarPath();
                    avatarBuffer = fs.existsSync(fallback) ? fs.readFileSync(fallback) : null;
                }
            } else if (ext === 'png') {
                avatarBuffer = fs.readFileSync(filePath);
                try { jsonData = JSON.parse(read(avatarBuffer)); }
                catch { jsonData = { name: entry.name }; }
            } else if (ext === 'json') {
                jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const fallback = getFallbackAvatarPath();
                avatarBuffer = fs.existsSync(fallback) ? fs.readFileSync(fallback) : null;
            } else if (ext === 'yaml' || ext === 'yml') {
                const yaml = await import('js-yaml');
                jsonData = yaml.load(fs.readFileSync(filePath, 'utf8')) || {};
                const fallback = getFallbackAvatarPath();
                avatarBuffer = fs.existsSync(fallback) ? fs.readFileSync(fallback) : null;
            } else {
                return res.status(400).json({ error: '不支持的文件格式' });
            }

            if (!avatarBuffer || avatarBuffer.length === 0) {
                const fallback = getFallbackAvatarPath();
                if (!fs.existsSync(fallback)) return res.status(500).json({ error: '找不到默认头像文件' });
                avatarBuffer = fs.readFileSync(fallback);
            }

            // Embed character data into PNG and save to user directory
            const timestamp = Date.now();
            const baseName = sanitize(jsonData?.data?.name || jsonData?.name || entry.name || 'character');
            const fileName = sanitize(`${baseName}_${timestamp}`);
            const newPng = write(avatarBuffer, JSON.stringify(jsonData));
            const outPath = path.join(userDirs.characters, `${fileName}.png`);
            fs.writeFileSync(outPath, newPng);

            // Create chat directory
            const chatsPath = path.join(userDirs.chats, fileName);
            if (!fs.existsSync(chatsPath)) fs.mkdirSync(chatsPath, { recursive: true });

            // Increment downloads
            entry.downloads = (entry.downloads || 0) + 1;
            saveCharIndex(index);

            res.json({ success: true, message: '角色卡导入成功', fileName });
        } catch (error) {
            console.error('[stc-mod] import error:', error);
            res.status(500).json({ error: error.message });
        }
    })();
});

/* ── Rate ── */

router.post('/rate/:id', express.json(), (req, res) => {
    const ratingNum = Number(req.body.rating);
    if (!ratingNum || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ error: '评分范围 1-5' });
    const index = loadCharIndex();
    const entry = index.find(c => c.id === req.params.id && !c.deleted);
    if (!entry) return res.status(404).json({ error: '角色卡不存在' });
    entry.ratings = entry.ratings || [];
    const handle = req.user.profile.handle;
    const existing = entry.ratings.findIndex(r => r.handle === handle);
    if (existing >= 0) entry.ratings[existing].rating = ratingNum;
    else entry.ratings.push({ handle, rating: ratingNum, createdAt: Date.now() });
    saveCharIndex(index);
    const avg = entry.ratings.reduce((s, r) => s + r.rating, 0) / entry.ratings.length;
    res.json({ success: true, avgRating: Math.round(avg * 10) / 10, count: entry.ratings.length });
});

/* ── Delete (author or admin) ── */

router.post('/delete/:id', express.json(), (req, res) => {
    const index = loadCharIndex();
    const entry = index.find(c => c.id === req.params.id);
    if (!entry) return res.status(404).json({ error: '角色卡不存在' });
    const handle = req.user.profile.handle;
    if (!req.user.profile.admin && entry.sharedBy !== handle) return res.status(403).json({ error: '无权限' });
    entry.deleted = true;
    saveCharIndex(index);
    res.json({ success: true });
});

/* ── Comments ── */

/** @param {string} charId */
function loadComments(charId) {
    const f = path.join(getCommentsDir(), `${charId}.json`);
    if (!fs.existsSync(f)) return [];
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch { return []; }
}

/** @param {string} charId @param {any[]} data */
function saveComments(charId, data) {
    fs.writeFileSync(path.join(getCommentsDir(), `${charId}.json`), JSON.stringify(data, null, 2), 'utf8');
}

/** @param {any[]} flat */
function buildCommentTree(flat) {
    /** @type {Record<string, any>} */
    const map = {};
    flat.forEach(c => { map[c.id] = { ...c, replies: [] }; });
    const roots = /** @type {any[]} */ ([]);
    flat.forEach(c => {
        if (c.parentId && map[c.parentId]) map[c.parentId].replies.push(map[c.id]);
        else if (!c.parentId) roots.push(map[c.id]);
    });
    return roots;
}

router.get('/:id/comments', (req, res) => {
    const index = loadCharIndex();
    if (!index.find(c => c.id === req.params.id && !c.deleted)) return res.status(404).json({ error: '角色卡不存在' });
    res.json(buildCommentTree(loadComments(req.params.id).filter(c => !c.deleted)));
});

router.post('/:id/comments', express.json(), (req, res) => {
    const { content, parentId } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: '评论内容不能为空' });
    const index = loadCharIndex();
    if (!index.find(c => c.id === req.params.id && !c.deleted)) return res.status(404).json({ error: '角色卡不存在' });
    const comment = {
        id: crypto.randomUUID(),
        charId: req.params.id,
        parentId: parentId || null,
        content: content.trim(),
        author: { handle: req.user.profile.handle, name: req.user.profile.name },
        createdAt: Date.now(),
        deleted: false,
    };
    const comments = loadComments(req.params.id);
    comments.push(comment);
    saveComments(req.params.id, comments);
    res.json(comment);
});

router.delete('/:id/comments/:commentId', (req, res) => {
    const comments = loadComments(req.params.id);
    const idx = comments.findIndex(c => c.id === req.params.commentId);
    if (idx < 0) return res.status(404).json({ error: '评论不存在' });
    const comment = comments[idx];
    const handle = req.user.profile.handle;
    if (!req.user.profile.admin && comment.author.handle !== handle) return res.status(403).json({ error: '无权限' });
    const toDelete = new Set([comment.id]);
    let changed = true;
    while (changed) {
        changed = false;
        comments.forEach(c => { if (c.parentId && toDelete.has(c.parentId) && !toDelete.has(c.id)) { toDelete.add(c.id); changed = true; } });
    }
    comments.forEach(c => { if (toDelete.has(c.id)) c.deleted = true; });
    saveComments(req.params.id, comments);
    res.json({ success: true, deletedCount: toDelete.size });
});
