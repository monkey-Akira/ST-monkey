/**
 * SillyTavernchat Module - Register Helper
 * Creates users by directly calling the official SillyTavern user storage APIs.
 * This avoids going through HTTP and requiring admin auth.
 */
import storage from 'node-persist';
import lodash from 'lodash';
import { checkForNewContent, CONTENT_TYPES } from '../../../endpoints/content-manager.js';
import {
    KEY_PREFIX,
    toKey,
    getAllUserHandles,
    getPasswordSalt,
    getPasswordHash,
    getUserDirectories,
    ensurePublicDirectoriesExist,
} from '../../../users.js';

function slugify(text) {
    return lodash.deburr(String(text ?? '').toLowerCase().trim()).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Create a user using the same logic as the official /api/users/create endpoint.
 * @param {string} handle User handle (will be slugified)
 * @param {string} name Display name
 * @param {string} password Password (empty string for no password)
 * @returns {Promise<{success: boolean, handle?: string, error?: string}>}
 */
export async function createUser(handle, name, password = '') {
    try {
        const slugHandle = slugify(handle);

        if (!slugHandle) {
            return { success: false, error: '无效的用户标识' };
        }

        const handles = await getAllUserHandles();
        if (handles.some(x => x === slugHandle)) {
            return { success: false, error: '该用户名已被注册' };
        }

        const salt = getPasswordSalt();
        const hashedPassword = password ? getPasswordHash(password, salt) : '';

        const newUser = {
            handle: slugHandle,
            name: name || 'Anonymous',
            created: Date.now(),
            password: hashedPassword,
            salt: salt,
            admin: false,
            enabled: true,
        };

        await storage.setItem(toKey(slugHandle), newUser);

        console.info('[STC-MOD] Creating data directories for', slugHandle);
        await ensurePublicDirectoriesExist();
        const directories = getUserDirectories(slugHandle);
        await checkForNewContent([directories], [CONTENT_TYPES.SETTINGS]);

        return { success: true, handle: slugHandle };
    } catch (error) {
        console.error('[STC-MOD] Create user failed:', error);
        return { success: false, error: error.message || '创建用户失败' };
    }
}
