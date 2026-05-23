/**
 * SillyTavernchat Module - OAuth Configuration (Admin)
 */
import express from 'express';
import { requireAdminMiddleware } from '../../../users.js';
import { getStcConfig, setStcConfig } from '../../config.js';

export const router = express.Router();

router.get('/config', requireAdminMiddleware, (req, res) => {
    const providers = ['github', 'discord', 'linuxdo'];
    const config = {};
    for (const p of providers) {
        config[p] = getStcConfig(`oauth.${p}`, {});
    }
    res.json(config);
});

router.post('/config', requireAdminMiddleware, (req, res) => {
    try {
        const { provider, enabled, clientId, clientSecret, callbackUrl, authUrl, tokenUrl, userInfoUrl } = req.body;
        if (!provider) return res.status(400).json({ error: '缺少 provider 参数' });

        if (enabled !== undefined) setStcConfig(`oauth.${provider}.enabled`, !!enabled);
        if (clientId !== undefined) setStcConfig(`oauth.${provider}.clientId`, clientId);
        if (clientSecret !== undefined) setStcConfig(`oauth.${provider}.clientSecret`, clientSecret);
        if (callbackUrl !== undefined) setStcConfig(`oauth.${provider}.callbackUrl`, callbackUrl);
        if (authUrl !== undefined) setStcConfig(`oauth.${provider}.authUrl`, authUrl);
        if (tokenUrl !== undefined) setStcConfig(`oauth.${provider}.tokenUrl`, tokenUrl);
        if (userInfoUrl !== undefined) setStcConfig(`oauth.${provider}.userInfoUrl`, userInfoUrl);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
