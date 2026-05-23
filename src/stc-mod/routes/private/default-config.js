/**
 * SillyTavernchat Module - Default Config Template (Admin)
 */
import express from 'express';
import { requireAdminMiddleware } from '../../../users.js';
import { saveTemplate, getTemplateMeta, deleteTemplate } from '../../services/default-template.js';

export const router = express.Router();

router.get('/template', requireAdminMiddleware, (req, res) => {
    const meta = getTemplateMeta();
    res.json(meta || { exists: false });
});

router.post('/template', requireAdminMiddleware, (req, res) => {
    try {
        const { sourceHandle, options } = req.body;
        if (!sourceHandle) return res.status(400).json({ error: '缺少源用户标识' });
        const meta = saveTemplate(sourceHandle, options || {});
        res.json({ success: true, meta });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/template/delete', requireAdminMiddleware, (req, res) => {
    try {
        deleteTemplate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
