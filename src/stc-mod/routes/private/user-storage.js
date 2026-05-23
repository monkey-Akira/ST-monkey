/**
 * SillyTavernchat Module - User Storage Management (Admin)
 */
import express from 'express';
import { requireAdminMiddleware } from '../../../users.js';
import { getStcConfig, setStcConfig } from '../../config.js';
import {
    getUserStorageInfo, isStorageLimitEnabled,
    generateStorageCodes, getAllStorageCodes, deleteStorageCode,
} from '../../services/storage-quota.js';
import { getAllUserMeta, setUserMeta } from '../../user-metadata.js';

export const router = express.Router();

// Admin: get storage config
router.get('/config', requireAdminMiddleware, (req, res) => {
    res.json({
        enabled: isStorageLimitEnabled(),
        defaultLimitMiB: getStcConfig('userStorage.defaultLimitMiB', 500),
        dailyCheckInMiB: getStcConfig('userStorage.dailyCheckInMiB', 0),
    });
});

// Admin: update storage config
router.post('/config', requireAdminMiddleware, (req, res) => {
    try {
        const { enabled, defaultLimitMiB, dailyCheckInMiB } = req.body;
        if (enabled !== undefined) setStcConfig('userStorage.enabled', !!enabled);
        if (defaultLimitMiB !== undefined) setStcConfig('userStorage.defaultLimitMiB', parseInt(defaultLimitMiB) || 500);
        if (dailyCheckInMiB !== undefined) setStcConfig('userStorage.dailyCheckInMiB', parseInt(dailyCheckInMiB) || 0);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: get all users storage info
router.get('/all-users', requireAdminMiddleware, (req, res) => {
    try {
        const allMeta = getAllUserMeta();
        const result = Object.entries(allMeta).map(([handle, meta]) => ({
            handle,
            ...getUserStorageInfo(handle),
        }));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: set user storage limit
router.post('/set-limit', requireAdminMiddleware, (req, res) => {
    try {
        const { handle, limitMiB } = req.body;
        if (!handle) return res.status(400).json({ error: '缺少用户标识' });
        setUserMeta(handle, { storageLimitMiB: parseInt(limitMiB) || 500 });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: generate storage expansion codes
router.post('/generate-codes', requireAdminMiddleware, (req, res) => {
    try {
        const { count, amountMiB } = req.body;
        const codes = generateStorageCodes(
            Math.min(parseInt(count) || 1, 100),
            parseInt(amountMiB) || 100,
            req.user.profile.handle,
        );
        res.json({ success: true, codes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: list storage codes
router.get('/codes', requireAdminMiddleware, (req, res) => {
    res.json(getAllStorageCodes());
});

// Admin: delete storage code
router.post('/delete-code', requireAdminMiddleware, (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: '缺少激活码' });
    res.json({ success: deleteStorageCode(code) });
});
