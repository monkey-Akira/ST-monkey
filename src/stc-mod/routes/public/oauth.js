/**
 * SillyTavernchat Module - OAuth Routes
 * Handles GitHub, Discord, Linux.do OAuth login/registration.
 */
import express from 'express';
import crypto from 'node:crypto';
import { getStcConfig } from '../../config.js';
import { findUserByOAuth, setUserMeta, getUserMeta } from '../../user-metadata.js';
import { createUser } from './register-helper.js';
import * as invitationService from '../../services/invitation-codes.js';
import { getDefaultLimitMiB, isStorageLimitEnabled } from '../../services/storage-quota.js';
import { applyTemplate, getTemplateMeta } from '../../services/default-template.js';
import { applyMonkeyApiDefaults } from '../../services/chat-completion-defaults.js';

export const router = express.Router();

const oauthStates = new Map();
const STATE_EXPIRY = 10 * 60 * 1000;

function getCallbackUrl(req, provider) {
    const configured = getStcConfig(`oauth.${provider}.callbackUrl`, '');
    if (configured) return configured;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}/api/stc/oauth/${provider}/callback`;
}

function normalizeQq(value) {
    return String(value ?? '').trim();
}

function isValidQq(value) {
    return /^[1-9][0-9]{4,10}$/.test(value);
}

// Initiate OAuth flow
router.get('/:provider', (req, res) => {
    const { provider } = req.params;
    const config = getStcConfig(`oauth.${provider}`, {});
    if (!config?.enabled) return res.status(404).json({ error: 'OAuth provider not enabled' });

    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, { provider, createdAt: Date.now() });
    setTimeout(() => oauthStates.delete(state), STATE_EXPIRY);

    const callbackUrl = getCallbackUrl(req, provider);
    let authUrl;

    switch (provider) {
        case 'github':
            authUrl = `https://github.com/login/oauth/authorize?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}&scope=read:user,user:email`;
            break;
        case 'discord':
            authUrl = `https://discord.com/api/oauth2/authorize?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=identify%20email&state=${state}`;
            break;
        case 'linuxdo':
            authUrl = `${config.authUrl || 'https://connect.linux.do/oauth2/authorize'}?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&state=${state}`;
            break;
        default:
            return res.status(400).json({ error: 'Unknown provider' });
    }

    res.redirect(authUrl);
});

// OAuth callback
router.get('/:provider/callback', async (req, res) => {
    try {
        const { provider } = req.params;
        const { code, state } = req.query;

        if (!provider) {
            return res.status(400).send('缺少 OAuth 提供商参数');
        }

        const providerStr = String(provider);
        const authCode = typeof code === 'string' ? code : '';

        if (!authCode) {
            return res.status(400).send('缺少授权 code');
        }

        if (!state || typeof state !== 'string' || !oauthStates.has(state)) {
            return res.status(400).send('无效的 OAuth 状态参数');
        }
        oauthStates.delete(state);

        const config = getStcConfig(`oauth.${providerStr}`, {});
        if (!config?.enabled) return res.status(404).send('OAuth 提供商未启用');

        const callbackUrl = getCallbackUrl(req, providerStr);
        const tokenData = await exchangeCode(providerStr, config, authCode, callbackUrl);
        const userInfo = await getUserInfo(providerStr, config, tokenData);

        if (!userInfo?.id) return res.status(400).send('无法获取用户信息');

        // Check if user already exists
        const existingHandle = findUserByOAuth(providerStr, String(userInfo.id));

        if (existingHandle) {
            // Login existing user
            setUserMeta(existingHandle, { lastLoginAt: Date.now() });
            if (req.session) {
                req.session.handle = existingHandle;
            }
            return res.redirect('/');
        }

        // New user - collect required registration annotations on the registration page.
        const encodedInfo = Buffer.from(JSON.stringify({
            provider, id: userInfo.id, username: userInfo.username,
            email: userInfo.email, avatar: userInfo.avatar,
        })).toString('base64');
        return res.redirect(`/register?oauth=${encodeURIComponent(encodedInfo)}`);
    } catch (error) {
        console.error('[STC-MOD] OAuth callback error:', error);
        res.status(500).send('OAuth 登录失败: ' + error.message);
    }
});

// Complete OAuth registration with invite code
router.post('/complete-registration', async (req, res) => {
    try {
        const { provider, id, username, email, avatar, inviteCode, qq } = req.body;

        if (!provider || !id) {
            return res.status(400).json({ error: '缺少必要参数' });
        }

        const qqNumber = normalizeQq(qq);
        if (!isValidQq(qqNumber)) {
            return res.status(400).json({ error: '请填写有效的QQ号' });
        }

        const providerStr = String(provider);
        const idStr = String(id);

        if (invitationService.isEnabled()) {
            if (!inviteCode) return res.status(400).json({ error: '需要邀请码' });
            const inviteCodeStr = String(inviteCode);
            const validation = invitationService.validateInvitationCode(inviteCodeStr);
            if (!validation.valid) return res.status(400).json({ error: validation.reason });
        }

        const baseUsername = (typeof username === 'string' && username.trim())
            ? username
            : `user-${id}`;
        const handle = baseUsername.toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .substring(0, 32);
        const result = await createUser(handle, baseUsername, '');

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        const userHandle = String(result.handle);

        let expiresAt = 0;
        if (invitationService.isEnabled() && inviteCode) {
            const inviteCodeStr = String(inviteCode);
            const useResult = invitationService.useInvitationCode(inviteCodeStr, userHandle);
            if (useResult.success) expiresAt = useResult.expiresAt ?? 0;
        }

        setUserMeta(userHandle, {
            oauthProvider: providerStr,
            oauthUserId: idStr,
            qq: qqNumber,
            email: email || null,
            avatar: avatar || null,
            expiresAt,
            createdAt: Date.now(),
            lastLoginAt: Date.now(),
            storageLimitMiB: isStorageLimitEnabled() ? getDefaultLimitMiB() : undefined,
        });

        if (getTemplateMeta()) {
            try { applyTemplate(userHandle); } catch {}
        }

        try { applyMonkeyApiDefaults(userHandle); }
        catch (e) { console.error('[STC-MOD] Apply Monkey API defaults failed:', e.message); }

        if (req.session) {
            req.session.handle = userHandle;
        }

        res.json({ success: true, handle: userHandle });
    } catch (error) {
        console.error('[STC-MOD] Complete OAuth registration error:', error);
        res.status(500).json({ error: '注册失败' });
    }
});

// --- Helper functions ---

async function exchangeCode(provider, config, code, callbackUrl) {
    let tokenUrl, body, headers;

    switch (provider) {
        case 'github':
            tokenUrl = 'https://github.com/login/oauth/access_token';
            body = JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: callbackUrl });
            headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
            break;
        case 'discord':
            tokenUrl = 'https://discord.com/api/oauth2/token';
            body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, grant_type: 'authorization_code', redirect_uri: callbackUrl }).toString();
            headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            break;
        case 'linuxdo':
            tokenUrl = config.tokenUrl || 'https://connect.linux.do/oauth2/token';
            body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, grant_type: 'authorization_code', redirect_uri: callbackUrl }).toString();
            headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            break;
        default:
            throw new Error('Unknown provider');
    }

    const resp = await fetch(tokenUrl, { method: 'POST', headers, body });
    if (!resp.ok) throw new Error(`Token exchange failed: ${resp.status}`);
    return await resp.json();
}

async function getUserInfo(provider, config, tokenData) {
    const token = tokenData.access_token;
    if (!token) throw new Error('No access token received');

    switch (provider) {
        case 'github': {
            const resp = await fetch('https://api.github.com/user', {
                headers: { 'Authorization': `token ${token}`, 'Accept': 'application/json', 'User-Agent': 'SillyTavern' },
            });
            const data = await resp.json();
            return { id: data.id, username: data.login, email: data.email, avatar: data.avatar_url };
        }
        case 'discord': {
            const resp = await fetch('https://discord.com/api/users/@me', {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await resp.json();
            const avatarUrl = data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png` : null;
            return { id: data.id, username: data.username, email: data.email, avatar: avatarUrl };
        }
        case 'linuxdo': {
            // Try to decode JWT first
            let userInfo = null;
            try {
                const parts = token.split('.');
                if (parts.length === 3) {
                    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                    if (payload.username) {
                        userInfo = { id: payload.sub || payload.id, username: payload.username, email: payload.email, avatar: payload.avatar_url };
                    }
                }
            } catch {}

            if (!userInfo) {
                const userInfoUrl = config.userInfoUrl || 'https://connect.linux.do/api/user';
                const resp = await fetch(userInfoUrl, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
                });
                const data = await resp.json();
                const userData = data.user || data;
                userInfo = {
                    id: userData.id || userData.sub,
                    username: userData.username || userData.login || userData.preferred_username || userData.name,
                    email: userData.email,
                    avatar: userData.avatar_url,
                };
            }
            return userInfo;
        }
        default:
            throw new Error('Unknown provider');
    }
}
