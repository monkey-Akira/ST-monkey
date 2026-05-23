/**
 * SillyTavernchat Module - Email Configuration (Admin)
 */
import express from 'express';
import { requireAdminMiddleware } from '../../../users.js';
import { getEmailConfigInfo, reloadEmailConfig, testEmailConfig } from '../../services/email-service.js';
import { setStcConfig } from '../../config.js';

export const router = express.Router();

router.get('/config', requireAdminMiddleware, (req, res) => {
    res.json(getEmailConfigInfo());
});

router.post('/config', requireAdminMiddleware, (req, res) => {
    try {
        const { enabled, host, port, secure, user, password, from, fromName } = req.body;
        setStcConfig('email.enabled', !!enabled);
        if (host !== undefined) setStcConfig('email.smtp.host', host);
        if (port !== undefined) setStcConfig('email.smtp.port', parseInt(port) || 587);
        if (secure !== undefined) setStcConfig('email.smtp.secure', !!secure);
        if (user !== undefined) setStcConfig('email.smtp.user', user);
        if (password !== undefined) setStcConfig('email.smtp.password', password);
        if (from !== undefined) setStcConfig('email.from', from);
        if (fromName !== undefined) setStcConfig('email.fromName', fromName);
        reloadEmailConfig();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/test', requireAdminMiddleware, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: '缺少测试邮箱地址' });
    const result = await testEmailConfig(email);
    res.json(result);
});
