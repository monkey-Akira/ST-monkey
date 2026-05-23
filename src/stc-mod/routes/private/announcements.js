/**
 * SillyTavernchat Module - Announcements Management (Admin)
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireAdminMiddleware } from '../../../users.js';
import { getStcDataDir } from '../../config.js';

export const router = express.Router();

function getAnnouncementsDir() {
    const dir = path.join(getStcDataDir(), 'announcements');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function loadAnnouncements(type = 'main') {
    const file = type === 'login' ? 'login_announcements.json' : 'announcements.json';
    const filePath = path.join(getAnnouncementsDir(), file);
    if (!fs.existsSync(filePath)) return [];
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return []; }
}

function saveAnnouncements(data, type = 'main') {
    const file = type === 'login' ? 'login_announcements.json' : 'announcements.json';
    fs.writeFileSync(path.join(getAnnouncementsDir(), file), JSON.stringify(data, null, 2), 'utf8');
}

// Get current active announcements (for logged-in users)
router.get('/current', (req, res) => {
    const announcements = loadAnnouncements('main').filter(a => a.enabled);
    res.json(announcements);
});

// Admin: list all announcements
router.get('/list', requireAdminMiddleware, (req, res) => {
    const type = String(req.query.type ?? 'main');
    res.json(loadAnnouncements(type));
});

// Admin: create announcement
router.post('/create', requireAdminMiddleware, (req, res) => {
    try {
        const { title, content, category, type: announcementType, enabled } = req.body;
        const type = String(req.query.type ?? 'main');
        const announcements = loadAnnouncements(type);
        const newAnn = {
            id: crypto.randomUUID(),
            title: title || '',
            content: content || '',
            category: category || 'general',
            type: announcementType || 'info',
            enabled: enabled !== false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            createdBy: req.user?.profile?.handle || 'admin',
        };
        announcements.push(newAnn);
        saveAnnouncements(announcements, type);
        res.json({ success: true, announcement: newAnn });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: update announcement
router.post('/update', requireAdminMiddleware, (req, res) => {
    try {
        const { id, title, content, category, type: announcementType, enabled } = req.body;
        const type = String(req.query.type ?? 'main');
        const announcements = loadAnnouncements(type);
        const idx = announcements.findIndex(a => a.id === id);
        if (idx === -1) return res.status(404).json({ error: '公告不存在' });

        if (title !== undefined) announcements[idx].title = title;
        if (content !== undefined) announcements[idx].content = content;
        if (category !== undefined) announcements[idx].category = category;
        if (announcementType !== undefined) announcements[idx].type = announcementType;
        if (enabled !== undefined) announcements[idx].enabled = enabled;
        announcements[idx].updatedAt = Date.now();

        saveAnnouncements(announcements, type);
        res.json({ success: true, announcement: announcements[idx] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: delete announcement
router.post('/delete', requireAdminMiddleware, (req, res) => {
    try {
        const { id } = req.body;
        const type = String(req.query.type ?? 'main');
        const announcements = loadAnnouncements(type);
        const filtered = announcements.filter(a => a.id !== id);
        if (filtered.length === announcements.length) return res.status(404).json({ error: '公告不存在' });
        saveAnnouncements(filtered, type);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
