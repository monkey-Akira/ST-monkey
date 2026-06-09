/**
 * SillyTavernchat Module - Extended User Metadata
 * Maintains a separate data store for user extension fields (OAuth, email, storage, expiration).
 * Does NOT modify the official users.js user model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getStcDataDir } from './config.js';

const METADATA_FILE = 'user-metadata.json';

let metadataCache = null;

function getMetadataPath() {
    return path.join(getStcDataDir(), METADATA_FILE);
}

function loadMetadata() {
    if (metadataCache) return metadataCache;
    const filePath = getMetadataPath();
    if (!fs.existsSync(filePath)) {
        metadataCache = {};
        return metadataCache;
    }
    try {
        metadataCache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error('[STC-MOD] Failed to read user metadata:', e.message);
        metadataCache = {};
    }
    return metadataCache;
}

function saveMetadata() {
    try {
        const filePath = getMetadataPath();
        fs.writeFileSync(filePath, JSON.stringify(metadataCache, null, 2), 'utf8');
    } catch (e) {
        console.error('[STC-MOD] Failed to save user metadata:', e.message);
    }
}

/**
 * @typedef {Object} UserExtendedData
 * @property {string} [qq] - User QQ number
 * @property {string} [email] - User email
 * @property {string} [oauthProvider] - OAuth provider name (github/discord/linuxdo)
 * @property {string} [oauthUserId] - OAuth user ID from provider
 * @property {string} [avatar] - Avatar URL or base64
 * @property {number} [storageLimitMiB] - Storage limit in MiB
 * @property {string} [storageLastCheckInDate] - Last check-in date (YYYY-MM-DD)
 * @property {number} [expiresAt] - Account expiration timestamp (ms), 0 = permanent
 * @property {number} [createdAt] - Registration timestamp
 * @property {number} [lastLoginAt] - Last login timestamp
 * @property {string} [inviteCodeUsed] - Invite code used for registration
 */

/**
 * Get extended data for a user
 * @param {string} handle User handle
 * @returns {UserExtendedData|null}
 */
export function getUserMeta(handle) {
    const meta = loadMetadata();
    return meta[handle] || null;
}

/**
 * Set extended data for a user (merge with existing)
 * @param {string} handle User handle
 * @param {Partial<UserExtendedData>} data Data to merge
 */
export function setUserMeta(handle, data) {
    const meta = loadMetadata();
    if (!meta[handle]) {
        meta[handle] = {};
    }
    Object.assign(meta[handle], data);
    saveMetadata();
}

/**
 * Delete extended data for a user
 * @param {string} handle
 */
export function deleteUserMeta(handle) {
    const meta = loadMetadata();
    delete meta[handle];
    saveMetadata();
}

/**
 * Get all user metadata entries
 * @returns {Object<string, UserExtendedData>}
 */
export function getAllUserMeta() {
    return { ...loadMetadata() };
}

/**
 * Check if a user account has expired
 * @param {string} handle
 * @returns {boolean}
 */
export function isUserExpired(handle) {
    const meta = getUserMeta(handle);
    if (!meta || !meta.expiresAt) return false;
    if (meta.expiresAt === 0) return false; // permanent
    return Date.now() > meta.expiresAt;
}

/**
 * Find user handle by OAuth provider and user ID
 * @param {string} provider
 * @param {string} oauthUserId
 * @returns {string|null} handle or null
 */
export function findUserByOAuth(provider, oauthUserId) {
    const meta = loadMetadata();
    for (const [handle, data] of Object.entries(meta)) {
        if (data.oauthProvider === provider && String(data.oauthUserId) === String(oauthUserId)) {
            return handle;
        }
    }
    return null;
}

/**
 * Find user handle by email
 * @param {string} email
 * @returns {string|null} handle or null
 */
export function findUserByEmail(email) {
    if (!email) return null;
    const meta = loadMetadata();
    const lowerEmail = email.toLowerCase();
    for (const [handle, data] of Object.entries(meta)) {
        if (data.email && data.email.toLowerCase() === lowerEmail) {
            return handle;
        }
    }
    return null;
}

/**
 * Update user's last login timestamp
 * @param {string} handle
 */
export function recordLogin(handle) {
    setUserMeta(handle, { lastLoginAt: Date.now() });
}

/**
 * Extend user expiration by a duration in milliseconds.
 * Pass durationMs = 0 to set the account as permanent (expiresAt = 0).
 * @param {string} handle
 * @param {number} durationMs  0 means permanent
 */
export function extendExpiration(handle, durationMs) {
    if (durationMs === 0) {
        setUserMeta(handle, { expiresAt: 0 });
        return;
    }
    const meta = getUserMeta(handle) || {};
    const now = Date.now();
    const currentExpiry = meta.expiresAt ?? now;
    const base = (currentExpiry !== 0 && currentExpiry > now) ? currentExpiry : now;
    setUserMeta(handle, { expiresAt: base + durationMs });
}

/**
 * Invalidate the in-memory cache (for testing or force-reload)
 */
export function invalidateCache() {
    metadataCache = null;
}
