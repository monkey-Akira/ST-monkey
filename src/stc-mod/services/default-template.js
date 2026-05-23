/**
 * SillyTavernchat Module - Default User Template Service
 * Manages default configuration templates that are applied to new users.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getStcDataDir, getDataRoot } from '../config.js';

const TEMPLATE_DIR = 'default-template';

function getTemplateDir() {
    const dir = path.join(getStcDataDir(), TEMPLATE_DIR);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getTemplateMetaPath() {
    return path.join(getTemplateDir(), 'template-meta.json');
}

function loadTemplateMeta() {
    const metaPath = getTemplateMetaPath();
    if (!fs.existsSync(metaPath)) return null;
    try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
    catch { return null; }
}

/**
 * Save a user's configuration as the default template
 * @param {string} sourceHandle The user handle to snapshot from
 * @param {Object} options Which items to include
 */
export function saveTemplate(sourceHandle, options = {}) {
    const {
        includeSettings = true,
        includeSecrets = false,
        includePresets = true,
        includeRegex = true,
        includeCharacters = false,
        includeWorlds = false,
        includeThemes = true,
    } = options;

    const sourceDir = path.join(getDataRoot(), sourceHandle);
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`Source user directory not found: ${sourceHandle}`);
    }

    const templateDir = getTemplateDir();

    // Clean existing template
    const oldFiles = fs.readdirSync(templateDir).filter(f => f !== 'template-meta.json');
    for (const f of oldFiles) {
        const fp = path.join(templateDir, f);
        if (fs.statSync(fp).isDirectory()) {
            fs.rmSync(fp, { recursive: true, force: true });
        } else {
            fs.unlinkSync(fp);
        }
    }

    const copied = [];

    function copyFile(relPath) {
        const src = path.join(sourceDir, relPath);
        const dst = path.join(templateDir, relPath);
        if (fs.existsSync(src)) {
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(src, dst);
            copied.push(relPath);
        }
    }

    function copyDir(relPath) {
        const src = path.join(sourceDir, relPath);
        const dst = path.join(templateDir, relPath);
        if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
            fs.cpSync(src, dst, { recursive: true });
            copied.push(relPath + '/');
        }
    }

    if (includeSettings) copyFile('settings.json');
    if (includeSecrets) copyFile('secrets.json');
    if (includePresets) {
        copyDir('TextGen Settings');
        copyDir('OpenAI Settings');
        copyDir('NovelAI Settings');
        copyDir('KoboldAI Settings');
    }
    if (includeRegex) copyDir('regex');
    if (includeCharacters) copyDir('characters');
    if (includeWorlds) copyDir('worlds');
    if (includeThemes) copyDir('themes');

    const meta = {
        sourceHandle,
        createdAt: Date.now(),
        options,
        copiedItems: copied,
    };
    fs.writeFileSync(getTemplateMetaPath(), JSON.stringify(meta, null, 2), 'utf8');

    console.log(`[STC-MOD] Default template saved from user: ${sourceHandle}`);
    return meta;
}

/**
 * Apply default template to a new user directory
 * @param {string} targetHandle
 */
export function applyTemplate(targetHandle) {
    const meta = loadTemplateMeta();
    if (!meta) return false;

    const templateDir = getTemplateDir();
    const targetDir = path.join(getDataRoot(), targetHandle);

    if (!fs.existsSync(targetDir)) return false;

    const files = fs.readdirSync(templateDir).filter(f => f !== 'template-meta.json');
    for (const f of files) {
        const src = path.join(templateDir, f);
        const dst = path.join(targetDir, f);
        try {
            if (fs.statSync(src).isDirectory()) {
                fs.cpSync(src, dst, { recursive: true });
            } else {
                fs.copyFileSync(src, dst);
            }
        } catch (e) {
            console.error(`[STC-MOD] Failed to apply template file ${f}:`, e.message);
        }
    }

    console.log(`[STC-MOD] Default template applied to user: ${targetHandle}`);
    return true;
}

/**
 * Get current template metadata
 */
export function getTemplateMeta() {
    return loadTemplateMeta();
}

/**
 * Delete current template
 */
export function deleteTemplate() {
    const templateDir = getTemplateDir();
    const files = fs.readdirSync(templateDir);
    for (const f of files) {
        const fp = path.join(templateDir, f);
        if (fs.statSync(fp).isDirectory()) {
            fs.rmSync(fp, { recursive: true, force: true });
        } else {
            fs.unlinkSync(fp);
        }
    }
    return true;
}
