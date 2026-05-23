/**
 * SillyTavernchat Module - Email Service
 * Ported from SillyTavernchat, adapted to use stc-mod config.
 */
import { getStcConfig } from '../config.js';

let emailConfig = null;
let transporter = null;

function loadEmailConfig() {
    try {
        const config = {
            enabled: getStcConfig('email.enabled', false),
            host: getStcConfig('email.smtp.host', ''),
            port: getStcConfig('email.smtp.port', 587),
            secure: getStcConfig('email.smtp.secure', false),
            user: getStcConfig('email.smtp.user', ''),
            password: getStcConfig('email.smtp.password', ''),
            from: getStcConfig('email.from', ''),
            fromName: getStcConfig('email.fromName', 'SillyTavern'),
        };

        if (config.enabled && (!config.host || !config.user || !config.password || !config.from)) {
            console.warn('[STC-MOD] Email service enabled but config incomplete');
            return null;
        }
        return config;
    } catch (error) {
        console.error('[STC-MOD] Failed to load email config:', error);
        return null;
    }
}

async function getNodemailer() {
    try {
        return (await import('nodemailer')).default;
    } catch {
        console.warn('[STC-MOD] nodemailer not installed. Email features disabled. Run: npm install nodemailer');
        return null;
    }
}

async function initTransporter() {
    emailConfig = loadEmailConfig();
    if (!emailConfig?.enabled) return null;

    const nodemailer = await getNodemailer();
    if (!nodemailer) return null;

    try {
        const useSSL = emailConfig.port === 465 ? true : emailConfig.secure;
        const transportConfig = {
            host: emailConfig.host,
            port: emailConfig.port,
            secure: useSSL,
            auth: { user: emailConfig.user, pass: emailConfig.password },
        };

        if (!useSSL && emailConfig.port === 587) {
            transportConfig.requireTLS = true;
            transportConfig.tls = { ciphers: 'SSLv3', rejectUnauthorized: false };
        }

        transporter = nodemailer.createTransport(transportConfig);
        console.log('[STC-MOD] Email service initialized');
        return transporter;
    } catch (error) {
        console.error('[STC-MOD] Failed to init email transporter:', error);
        return null;
    }
}

export function isEmailServiceAvailable() {
    if (!transporter) initTransporter();
    return transporter !== null && emailConfig?.enabled === true;
}

export function getEmailConfigInfo() {
    if (!emailConfig) emailConfig = loadEmailConfig();
    if (!emailConfig) return { enabled: false };
    return { ...emailConfig };
}

export function reloadEmailConfig() {
    transporter = null;
    emailConfig = null;
    initTransporter();
}

/**
 * @param {string} to
 * @param {string} subject
 * @param {string} text
 * @param {string|null} [html]
 */
export async function sendEmail(to, subject, text, html = null) {
    if (!isEmailServiceAvailable()) {
        console.error('[STC-MOD] Email service not available');
        return false;
    }
    try {
        const mailOptions = {
            from: `"${emailConfig.fromName}" <${emailConfig.from}>`,
            to, subject, text,
        };
        if (html) mailOptions.html = html;
        const info = await transporter.sendMail(mailOptions);
        console.log('[STC-MOD] Email sent:', info.messageId, 'to', to);
        return true;
    } catch (error) {
        console.error('[STC-MOD] Send email failed:', error);
        return false;
    }
}

export async function sendVerificationCode(to, code, userName) {
    const subject = 'SillyTavern - 注册验证码';
    const text = `尊敬的 ${userName}，\n\n您的验证码是：${code}\n\n此验证码将在 5 分钟内有效。\n\nSillyTavern 团队`;
    const html = `
<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif">
  <div style="background:#4a90e2;color:#fff;padding:20px;text-align:center;border-radius:5px 5px 0 0"><h1>SillyTavern 注册验证</h1></div>
  <div style="background:#f9f9f9;padding:30px;border:1px solid #ddd;border-top:none">
    <p>尊敬的 <strong>${userName}</strong>，</p>
    <p>您的验证码是：</p>
    <div style="background:#fff;border:2px dashed #4a90e2;padding:20px;text-align:center;font-size:32px;font-weight:bold;letter-spacing:5px;margin:20px 0;color:#4a90e2">${code}</div>
    <p>此验证码将在 <strong>5 分钟</strong>内有效。</p>
  </div>
  <div style="background:#f0f0f0;padding:15px;text-align:center;font-size:12px;color:#666;border-radius:0 0 5px 5px">系统自动发送，请勿回复。</div>
</div>`;
    return await sendEmail(to, subject, text, html);
}

export async function sendPasswordRecoveryCode(to, code, userName) {
    const subject = 'SillyTavern - 密码找回';
    const text = `尊敬的 ${userName}，\n\n您的密码恢复码是：${code}\n\n此恢复码将在 5 分钟内有效。\n\nSillyTavern 团队`;
    const html = `
<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif">
  <div style="background:#e74c3c;color:#fff;padding:20px;text-align:center;border-radius:5px 5px 0 0"><h1>密码找回请求</h1></div>
  <div style="background:#f9f9f9;padding:30px;border:1px solid #ddd;border-top:none">
    <p>尊敬的 <strong>${userName}</strong>，</p>
    <p>您的密码恢复码是：</p>
    <div style="background:#fff;border:2px dashed #e74c3c;padding:20px;text-align:center;font-size:32px;font-weight:bold;letter-spacing:5px;margin:20px 0;color:#e74c3c">${code}</div>
    <p>此恢复码将在 <strong>5 分钟</strong>内有效。</p>
    <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:15px;margin:15px 0"><strong>安全提醒：</strong>如非本人操作，请立即联系管理员。</div>
  </div>
  <div style="background:#f0f0f0;padding:15px;text-align:center;font-size:12px;color:#666;border-radius:0 0 5px 5px">系统自动发送，请勿回复。</div>
</div>`;
    return await sendEmail(to, subject, text, html);
}

export async function testEmailConfig(testEmail) {
    if (!isEmailServiceAvailable()) {
        return { success: false, error: '邮件服务未启用或配置不完整' };
    }
    try {
        await transporter.verify();
        const success = await sendEmail(testEmail, 'SillyTavern - 邮件配置测试',
            '这是一封测试邮件。如果您收到此邮件，说明邮件服务配置正确。',
            `<div style="background:#d4edda;border:1px solid #c3e6cb;color:#155724;padding:20px;border-radius:5px;text-align:center"><h2>✓ 邮件配置测试成功</h2><p>${new Date().toLocaleString('zh-CN')}</p></div>`);
        return success ? { success: true } : { success: false, error: '邮件发送失败' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
