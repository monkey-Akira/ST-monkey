/**
 * SillyTavernchat Module - Public Invitation Code Status
 */
import express from 'express';
import { getStcConfig } from '../../config.js';
import { getPurchaseLink } from '../../services/invitation-codes.js';

export const router = express.Router();

router.get('/status', (req, res) => {
    const enabled = !!getStcConfig('enableInvitationCodes', false);
    res.json({
        enabled,
        purchaseLink: enabled ? getPurchaseLink() : undefined,
    });
});
