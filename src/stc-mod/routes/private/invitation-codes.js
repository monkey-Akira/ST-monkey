/**
 * SillyTavernchat Module - Invitation Codes Management (Admin)
 */
import express from 'express';
import { requireAdminMiddleware } from '../../../users.js';
import * as service from '../../services/invitation-codes.js';
import { getStcConfig, setStcConfig } from '../../config.js';

export const router = express.Router();

router.post('/create', requireAdminMiddleware, (req, res) => {
    try {
        const { durationType, count } = req.body;
        const createdBy = req.user.profile.handle;
        const results = [];
        const num = Math.min(parseInt(count) || 1, 100);
        for (let i = 0; i < num; i++) {
            results.push(service.createInvitationCode(createdBy, durationType || 'permanent'));
        }
        res.json({ success: true, codes: results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/list', requireAdminMiddleware, (req, res) => {
    try {
        const codes = service.getAllInvitationCodes();
        res.json(codes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/delete', requireAdminMiddleware, (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: '缺少邀请码' });
        const result = service.deleteInvitationCode(code);
        res.json({ success: result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/purchase-link', requireAdminMiddleware, (req, res) => {
    res.json({ purchaseLink: getStcConfig('purchaseLink', '') });
});

router.post('/purchase-link', requireAdminMiddleware, (req, res) => {
    try {
        setStcConfig('purchaseLink', req.body.purchaseLink || '');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
