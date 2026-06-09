/**
 * SillyTavernchat Module - Extended User Endpoints
 * Renew, profile, heartbeat, storage info, check-in
 */
import express from 'express';
import { promises as fsPromises } from 'fs';
import fs from 'fs';
import path from 'path';
import storage from 'node-persist';
import { getUserMeta, setUserMeta, getAllUserMeta, isUserExpired, deleteUserMeta } from '../../user-metadata.js';
import * as invitationService from '../../services/invitation-codes.js';
import { getUserStorageInfo, dailyCheckIn, canUserWrite, useStorageCode, calculateUserStorage } from '../../services/storage-quota.js';
import { requireAdminMiddleware, getAllUserHandles, toKey, getUserDirectories } from '../../../users.js';
import { getStcConfig } from '../../config.js';

export const router = express.Router();

// Get extended user info (current user)
router.get('/me-ext', (req, res) => {
    const handle = req.user?.profile?.handle;
    if (!handle) return res.status(401).json({ error: 'Not authenticated' });
    const meta = getUserMeta(handle) || {};
    const storage = getUserStorageInfo(handle);
    res.json({
        handle,
        qq: meta.qq,
        email: meta.email,
        oauthProvider: meta.oauthProvider,
        expiresAt: meta.expiresAt,
        createdAt: meta.createdAt,
        lastLoginAt: meta.lastLoginAt,
        storage,
    });
});

// Renew logged-in user with invite code
router.post('/renew', (req, res) => {
    try {
        const { inviteCode } = req.body;
        const handle = req.user?.profile?.handle;
        if (!handle) return res.status(401).json({ error: 'Not authenticated' });
        if (!inviteCode) return res.status(400).json({ error: '缺少邀请码' });

        if (!invitationService.isEnabled()) {
            return res.status(400).json({ error: '邀请码系统未启用' });
        }

        const validation = invitationService.validateInvitationCode(inviteCode);
        if (!validation.valid) return res.status(400).json({ error: validation.reason });

        const useResult = invitationService.useInvitationCode(inviteCode, handle);
        if (!useResult.success) return res.status(400).json({ error: '邀请码使用失败' });

        setUserMeta(handle, { expiresAt: useResult.expiresAt ?? 0 });
        res.json({ success: true, expiresAt: useResult.expiresAt ?? 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Heartbeat
router.post('/heartbeat', (req, res) => {
    const handle = req.user?.profile?.handle;
    if (handle) setUserMeta(handle, { lastLoginAt: Date.now() });
    res.sendStatus(204);
});

// Storage info
router.get('/storage', (req, res) => {
    const handle = req.user?.profile?.handle;
    if (!handle) return res.status(401).json({ error: 'Not authenticated' });
    res.json(getUserStorageInfo(handle));
});

// Check if can write
router.get('/can-write', (req, res) => {
    const handle = req.user?.profile?.handle;
    if (!handle) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ canWrite: canUserWrite(handle) });
});

// Daily check-in
router.post('/check-in', (req, res) => {
    const handle = req.user?.profile?.handle;
    if (!handle) return res.status(401).json({ error: 'Not authenticated' });
    const result = dailyCheckIn(handle);
    res.json(result);
});

// Use storage expansion code
router.post('/use-storage-code', (req, res) => {
    const handle = req.user?.profile?.handle;
    if (!handle) return res.status(401).json({ error: 'Not authenticated' });
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: '缺少激活码' });
    res.json(useStorageCode(code, handle));
});

// Admin: get all extended user metadata
router.get('/all-meta', requireAdminMiddleware, (req, res) => {
    res.json(getAllUserMeta());
});

/**
 * Get the last chat time for a user by scanning their chats directory
 * @param {string} handle - User handle
 * @returns {number|null} - Timestamp of last chat modification, or null if no chats
 */
function getLastChatTime(handle) {
    try {
        const dirs = getUserDirectories(handle);
        const chatsDir = dirs.chats;

        if (!fs.existsSync(chatsDir)) {
            return null;
        }

        const files = fs.readdirSync(chatsDir);
        if (files.length === 0) {
            return null;
        }

        let lastTime = 0;
        for (const file of files) {
            const filePath = path.join(chatsDir, file);
            try {
                const stats = fs.statSync(filePath);
                if (stats.isFile() && stats.mtimeMs > lastTime) {
                    lastTime = stats.mtimeMs;
                }
            } catch (e) {
                // Skip files that can't be read
                continue;
            }
        }

        return lastTime > 0 ? Math.floor(lastTime) : null;
    } catch (e) {
        return null;
    }
}

// Admin: get users with expiration info
router.get('/expiration-list', requireAdminMiddleware, async (req, res) => {
    try {
        const allMeta = getAllUserMeta();
        const handles = await getAllUserHandles();
        const result = handles.map(h => {
            const lastChatTime = getLastChatTime(h);
            return {
                handle: h,
                expired: isUserExpired(h),
                lastChatTime,
                ...(allMeta[h] || {}),
            };
        });

        // Sort by lastChatTime (most recent first), then by lastLoginAt
        result.sort((a, b) => {
            const aTime = a.lastChatTime || a.lastLoginAt || a.createdAt || 0;
            const bTime = b.lastChatTime || b.lastLoginAt || b.createdAt || 0;
            return bTime - aTime;
        });

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: delete expired inactive users (optional email notification before deletion)
router.post('/delete-inactive', requireAdminMiddleware, async (req, res) => {
    try {
        const { maxInactiveDays, minStorageMB, dryRun, sendEmailNotice } = req.body;
        const allMeta = getAllUserMeta();
        const now = Date.now();
        const threshold = (maxInactiveDays || 30) * 24 * 60 * 60 * 1000;
        // minStorageMB: only users whose storage < this value are considered inactive candidates
        // 0 or undefined means no storage filter (all inactive users qualify)
        const minStorageBytes = (minStorageMB > 0) ? minStorageMB * 1024 * 1024 : 0;
        const candidates = [];

        for (const [handle, meta] of Object.entries(allMeta)) {
            if (handle === 'default-user') continue;
            if (!isUserExpired(handle)) continue;
            const lastActive = meta.lastLoginAt || meta.createdAt || 0;
            if (now - lastActive > threshold) {
                // Skip users with significant data (storage >= minStorageMB)
                if (minStorageBytes > 0) {
                    const usedBytes = calculateUserStorage(handle);
                    if (usedBytes >= minStorageBytes) continue;
                    const daysInactive = Math.floor((now - lastActive) / 86400000);
                    const usedMiB = Math.round(usedBytes / 1024 / 1024 * 100) / 100;
                    candidates.push({ handle, lastLoginAt: meta.lastLoginAt, email: meta.email, expiresAt: meta.expiresAt, daysInactive, usedMiB });
                } else {
                    const daysInactive = Math.floor((now - lastActive) / 86400000);
                    candidates.push({ handle, lastLoginAt: meta.lastLoginAt, email: meta.email, expiresAt: meta.expiresAt, daysInactive });
                }
            }
        }

        if (dryRun) {
            return res.json({ candidates, count: candidates.length });
        }

        // Send email notifications if requested
        /** @type {{ sent: number, skipped: number, errors: Array<{handle:string,error:string}> }} */
        const emailResults = { sent: 0, skipped: 0, errors: [] };
        if (sendEmailNotice) {
            try {
                const { sendEmail } = await import('../../services/email-service.js');
                const siteName = getStcConfig('email.fromName', 'SillyTavern');
                const siteUrl = getStcConfig('email.siteUrl', '');
                const adminContact = getStcConfig('email.from', '');
                const contactLine = adminContact
                    ? `请联系管理员：<a href="mailto:${adminContact}" style="color:#e74c3c">${adminContact}</a>`
                    : '请联系管理员。';
                for (const c of candidates) {
                    if (c.email) {
                        try {
                            await sendEmail(
                                c.email,
                                `[${siteName}] 您的账号数据已被清理`,
                                `您好 ${c.handle}，\n\n您在 ${siteName} 的账号已过期，且已 ${c.daysInactive} 天未登录/未续费。根据系统维护政策，该账号的数据已被清理。\n\n如有疑问，${adminContact ? '请联系管理员：' + adminContact : '请联系管理员。'}\n\n— ${siteName} 系统通知`,
                                `<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif">
  <div style="background:#e74c3c;color:#fff;padding:20px;text-align:center;border-radius:5px 5px 0 0">
    <h1 style="margin:0;font-size:22px">${siteName}</h1>
    <p style="margin:8px 0 0;opacity:.9;font-size:14px">账号清理通知</p>
  </div>
  <div style="background:#f9f9f9;padding:30px;border:1px solid #ddd;border-top:none">
    <p>您好，<strong>${c.handle}</strong>，</p>
    <p>您在 <strong>${siteName}</strong> 的账号已过期，且已 <strong>${c.daysInactive} 天</strong>未登录/未续费。</p>
    <div style="background:#fdf2f2;border-left:4px solid #e74c3c;padding:15px;margin:20px 0;border-radius:0 5px 5px 0">
      根据系统维护政策，该账号的所有数据已于今日被清理。如您希望继续使用，请重新注册账号或联系管理员处理续费。
    </div>
    <p style="color:#666;font-size:14px">如您认为这是误操作，或有任何疑问，${contactLine}</p>
    ${siteUrl ? `<p style="color:#666;font-size:14px">平台地址：<a href="${siteUrl}" style="color:#e74c3c">${siteUrl}</a></p>` : ''}
  </div>
  <div style="background:#f0f0f0;padding:15px;text-align:center;font-size:12px;color:#999;border-radius:0 0 5px 5px">
    此邮件由 ${siteName} 系统自动发送，请勿直接回复。
  </div>
</div>`,
                            );
                            emailResults.sent++;
                        } catch (e) {
                            emailResults.errors.push({ handle: c.handle, error: e.message });
                        }
                    } else {
                        emailResults.skipped++;
                    }
                }
            } catch (e) {
                emailResults.errors.push({ handle: 'email-service', error: e.message });
            }
        }

        // Fully purge each user: SillyTavern registry + data directory + STC metadata
        /** @type {Array<{handle:string,error:string}>} */
        const purgeErrors = [];
        for (const c of candidates) {
            try {
                // 1. Remove from SillyTavern user registry (node-persist)
                await storage.removeItem(toKey(c.handle));
                // 2. Delete user data directory (chats, characters, backups, etc.)
                const dirs = getUserDirectories(c.handle);
                await fsPromises.rm(dirs.root, { recursive: true, force: true });
            } catch (e) {
                purgeErrors.push({ handle: c.handle, error: e.message });
            }
            // 3. Remove STC extended metadata
            deleteUserMeta(c.handle);
        }

        res.json({ deleted: candidates.length, handles: candidates.map(c => c.handle), emailResults, purgeErrors });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: send warning emails to expired inactive users (without deleting)
router.post('/warn-inactive', requireAdminMiddleware, async (req, res) => {
    try {
        const { maxInactiveDays, minStorageMB } = req.body;
        const allMeta = getAllUserMeta();
        const now = Date.now();
        const threshold = (maxInactiveDays || 30) * 24 * 60 * 60 * 1000;
        const minStorageBytes = (minStorageMB > 0) ? minStorageMB * 1024 * 1024 : 0;
        const { sendEmail } = await import('../../services/email-service.js');
        const siteName = getStcConfig('email.fromName', 'SillyTavern');
        const siteUrl = getStcConfig('email.siteUrl', '');

        let sent = 0, skipped = 0;
        /** @type {Array<{handle:string,error:string}>} */
        const errors = [];

        for (const [handle, meta] of Object.entries(allMeta)) {
            if (handle === 'default-user') continue;
            if (!isUserExpired(handle)) continue;
            const lastActive = meta.lastLoginAt || meta.createdAt || 0;
            if (now - lastActive > threshold) {
                // Skip users with significant data
                if (minStorageBytes > 0 && calculateUserStorage(handle) >= minStorageBytes) continue;
                if (meta.email) {
                    const daysInactive = Math.floor((now - lastActive) / 86400000);
                    const loginLinkHtml = siteUrl
                        ? `<div style="text-align:center;margin:25px 0"><a href="${siteUrl}" style="background:#f39c12;color:#fff;padding:12px 30px;border-radius:5px;text-decoration:none;font-size:15px;display:inline-block">立即登录 ${siteName}</a></div>`
                        : '';
                    const siteUrlLine = siteUrl
                        ? `请访问 ${siteUrl} 登录并完成续费，或联系管理员。`
                        : '请尽快续费或联系管理员。';
                    try {
                        await sendEmail(
                            meta.email,
                            `[${siteName}] 账号已过期未续费提醒`,
                            `您好 ${handle}，\n\n您在 ${siteName} 的账号已过期，且已 ${daysInactive} 天未登录/未续费。\n\n为避免账号数据被系统清理，请尽快续费或联系管理员。${siteUrl ? '\n\n登录地址：' + siteUrl : ''}\n\n如有疑问，请联系管理员。\n\n— ${siteName} 系统通知`,
                            `<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif">
  <div style="background:#f39c12;color:#fff;padding:20px;text-align:center;border-radius:5px 5px 0 0">
    <h1 style="margin:0;font-size:22px">${siteName}</h1>
    <p style="margin:8px 0 0;opacity:.9;font-size:14px">账号续费提醒</p>
  </div>
  <div style="background:#f9f9f9;padding:30px;border:1px solid #ddd;border-top:none">
    <p>您好，<strong>${handle}</strong>，</p>
    <p>您在 <strong>${siteName}</strong> 的账号已过期，且已 <strong>${daysInactive} 天</strong>未登录/未续费。</p>
    <div style="background:#fff8e1;border-left:4px solid #f39c12;padding:15px;margin:20px 0;border-radius:0 5px 5px 0">
      <strong>⚠️ 温馨提示：</strong>根据系统维护政策，已过期且长期未续费的账号数据可能会被清理。请尽快续费或联系管理员以保留您的数据。
    </div>
    ${loginLinkHtml}
    <p style="color:#666;font-size:14px">如果按钮无法点击，${siteUrlLine}</p>
    <p style="color:#666;font-size:14px">如有任何疑问，请联系管理员。</p>
  </div>
  <div style="background:#f0f0f0;padding:15px;text-align:center;font-size:12px;color:#999;border-radius:0 0 5px 5px">
    此邮件由 ${siteName} 系统自动发送，请勿直接回复。
  </div>
</div>`,
                        );
                        sent++;
                    } catch (e) {
                        errors.push({ handle, error: e.message });
                    }
                } else {
                    skipped++;
                }
            }
        }

        res.json({ success: true, sent, skipped, errors });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: reset single user (delete all data but keep account)
router.post('/reset-user', requireAdminMiddleware, async (req, res) => {
    try {
        const { handle } = req.body;
        if (!handle) return res.status(400).json({ error: '缺少用户名' });
        if (handle === 'default-user') return res.status(400).json({ error: '不能重置默认用户' });

        const dirs = getUserDirectories(handle);

        // Delete all subdirectories but keep the root
        const subDirs = ['chats', 'characters', 'groups', 'worlds', 'avatars', 'backgrounds', 'assets', 'backups', 'instruct', 'context'];
        for (const subDir of subDirs) {
            const dirPath = dirs[subDir];
            if (dirPath) {
                try {
                    await fsPromises.rm(dirPath, { recursive: true, force: true });
                    // Recreate empty directory
                    await fsPromises.mkdir(dirPath, { recursive: true });
                } catch (e) {
                    // Ignore if directory doesn't exist
                }
            }
        }

        // Delete settings file
        const settingsPath = path.join(dirs.root, 'settings.json');
        try {
            await fsPromises.unlink(settingsPath);
        } catch (e) {
            // Ignore if file doesn't exist
        }

        res.json({ success: true, message: `用户 ${handle} 已重置` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: batch delete users
router.post('/delete-batch', requireAdminMiddleware, async (req, res) => {
    try {
        const { handles } = req.body;
        if (!Array.isArray(handles) || handles.length === 0) {
            return res.status(400).json({ error: '缺少用户列表' });
        }

        /** @type {{ deleted: string[], failed: Array<{handle: string, error: string}> }} */
        const results = { deleted: [], failed: [] };

        for (const handle of handles) {
            if (!handle || handle === 'default-user') {
                results.failed.push({ handle, error: '不能删除默认用户或无效用户名' });
                continue;
            }
            try {
                await storage.removeItem(toKey(handle));
                const dirs = getUserDirectories(handle);
                await fsPromises.rm(dirs.root, { recursive: true, force: true });
                deleteUserMeta(handle);
                results.deleted.push(handle);
            } catch (e) {
                results.failed.push({ handle, error: e.message });
            }
        }

        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: delete single user completely
router.post('/delete-single', requireAdminMiddleware, async (req, res) => {
    try {
        const { handle } = req.body;
        if (!handle) return res.status(400).json({ error: '缺少用户名' });
        if (handle === 'default-user') return res.status(400).json({ error: '不能删除默认用户' });

        // 1. Remove from SillyTavern user registry
        await storage.removeItem(toKey(handle));

        // 2. Delete user data directory
        const dirs = getUserDirectories(handle);
        await fsPromises.rm(dirs.root, { recursive: true, force: true });

        // 3. Remove STC extended metadata
        deleteUserMeta(handle);

        res.json({ success: true, message: `用户 ${handle} 已删除` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
