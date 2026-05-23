/**
 * SillyTavernchat Module - System Load Monitoring (Admin)
 */
import express from 'express';
import { requireAdminMiddleware } from '../../../users.js';
import { getSystemLoad, loadHistory, startMonitoring } from '../../services/system-monitor.js';

export const router = express.Router();

// Start monitoring on first import
startMonitoring();

router.get('/current', requireAdminMiddleware, (req, res) => {
    res.json(getSystemLoad());
});

router.get('/history', requireAdminMiddleware, (req, res) => {
    res.json(loadHistory());
});
