/**
 * SillyTavernchat Module - Public Announcements (Login Page)
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getStcDataDir } from '../../config.js';

export const router = express.Router();

function getLoginAnnouncementsPath() {
    const dir = path.join(getStcDataDir(), 'announcements');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'login_announcements.json');
}

router.get('/login/current', (req, res) => {
    try {
        const filePath = getLoginAnnouncementsPath();
        if (!fs.existsSync(filePath)) return res.json([]);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const valid = data.filter(a => a.enabled);
        res.json(valid);
    } catch (error) {
        console.error('[STC-MOD] Get login announcements error:', error);
        res.status(500).json({ error: 'Failed to get announcements' });
    }
});
