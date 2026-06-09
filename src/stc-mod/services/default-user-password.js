import storage from 'node-persist';
import { getPasswordHash, getPasswordSalt, toKey } from '../../users.js';

const DEFAULT_USER_HANDLE = 'default-user';
const DEFAULT_USER_PASSWORD = '123456';

export async function ensureDefaultUserPassword() {
    try {
        const key = toKey(DEFAULT_USER_HANDLE);
        const user = await storage.getItem(key);

        if (!user) {
            console.warn('[STC-MOD] default-user not found; skipped default password initialization.');
            return;
        }

        if (user.password) {
            return;
        }

        const salt = getPasswordSalt();
        user.password = getPasswordHash(DEFAULT_USER_PASSWORD, salt);
        user.salt = salt;
        await storage.setItem(key, user);
        console.log('[STC-MOD] Initialized default-user password.');
    } catch (error) {
        console.error('[STC-MOD] Failed to initialize default-user password:', error.message);
    }
}
