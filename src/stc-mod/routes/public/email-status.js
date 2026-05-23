/**
 * SillyTavernchat Module - Public Email Service Status
 */
import express from 'express';
import { isEmailServiceAvailable } from '../../services/email-service.js';

export const router = express.Router();

router.get('/status', (req, res) => {
    res.json({ enabled: isEmailServiceAvailable() });
});
