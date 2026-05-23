/**
 * SillyTavernchat Module - Invitation Codes Service
 * Uses file-based storage in stc-mod data directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getStcConfig, getStcDataDir } from '../config.js';
import { extendExpiration, getUserMeta } from '../user-metadata.js';

const CODES_FILE = 'invitation-codes.json';

function getCodesPath() {
    return path.join(getStcDataDir(), CODES_FILE);
}

function loadCodes() {
    const filePath = getCodesPath();
    if (!fs.existsSync(filePath)) return [];
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return [];
    }
}

function saveCodes(codes) {
    fs.writeFileSync(getCodesPath(), JSON.stringify(codes, null, 2), 'utf8');
}

function generateCode() {
    return crypto.randomBytes(8).toString('hex').toUpperCase();
}

const DURATION_MAP = {
    '1day': 1, '1week': 7, '1month': 30, '1quarter': 90,
    '6months': 180, '1year': 365, 'permanent': null,
};

function getDurationDays(type) {
    return DURATION_MAP[type] ?? null;
}

/**
 * Calculate expiration timestamp from a duration type
 * @param {string} durationType
 * @returns {number} 0 for permanent, timestamp for others
 */
export function calculateExpiration(durationType) {
    const days = getDurationDays(durationType);
    if (days === null) return 0;
    return Date.now() + days * 24 * 60 * 60 * 1000;
}

/**
 * Calculate duration in milliseconds from a duration type
 * @param {string} durationType
 * @returns {number|null} null for permanent, milliseconds for others
 */
function getDurationMs(durationType) {
    const days = getDurationDays(durationType);
    if (days === null) return null;
    return days * 24 * 60 * 60 * 1000;
}

export function isEnabled() {
    return !!getStcConfig('enableInvitationCodes', false);
}

export function createInvitationCode(createdBy, durationType = 'permanent') {
    const code = generateCode();
    const invitation = {
        code,
        createdBy,
        createdAt: Date.now(),
        used: false,
        usedBy: null,
        usedAt: null,
        durationType: durationType || 'permanent',
        durationDays: getDurationDays(durationType),
        userExpiresAt: null,
    };
    const codes = loadCodes();
    codes.push(invitation);
    saveCodes(codes);
    console.log(`[STC-MOD] Invitation code created: ${code} by ${createdBy}, duration: ${durationType}`);
    return invitation;
}

export function validateInvitationCode(code) {
    if (!isEnabled()) return { valid: true };
    if (!code || typeof code !== 'string') return { valid: false, reason: '邀请码格式无效' };

    const codes = loadCodes();
    const invitation = codes.find(c => c.code === code.toUpperCase());
    if (!invitation) return { valid: false, reason: '邀请码不存在' };
    if (invitation.used) return { valid: false, reason: '邀请码已被使用' };
    return { valid: true, invitation };
}

export function useInvitationCode(code, usedBy) {
    if (!isEnabled()) return { success: true };

    const validation = validateInvitationCode(code);
    if (!validation.valid) return { success: false, reason: validation.reason };

    const codes = loadCodes();
    const idx = codes.findIndex(c => c.code === code.toUpperCase());
    if (idx === -1) return { success: false, reason: '邀请码不存在' };

    const invitation = codes[idx];

    // Calculate new user expiration time by extending from current expiry
    const durationMs = getDurationMs(invitation.durationType);
    let userExpiresAt = 0;

    if (durationMs === null) {
        // Permanent: set expiresAt = 0
        extendExpiration(usedBy, 0);
        userExpiresAt = 0;
    } else {
        extendExpiration(usedBy, durationMs);
        const meta = getUserMeta(usedBy) || {};
        userExpiresAt = meta.expiresAt ?? 0;
    }

    codes[idx] = {
        ...invitation,
        used: true,
        usedBy,
        usedAt: Date.now(),
        userExpiresAt,
    };
    saveCodes(codes);

    console.log(`[STC-MOD] Invitation code used: ${code} by ${usedBy}`);
    return { success: true, invitation: codes[idx], expiresAt: userExpiresAt };
}

export function getAllInvitationCodes() {
    if (!isEnabled()) return [];
    return loadCodes()
        .filter(c => c.code && typeof c.code === 'string')
        .sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteInvitationCode(code) {
    const codes = loadCodes();
    const idx = codes.findIndex(c => c.code === code.toUpperCase());
    if (idx === -1) return false;
    codes.splice(idx, 1);
    saveCodes(codes);
    return true;
}

export function getPurchaseLink() {
    return getStcConfig('purchaseLink', '');
}
