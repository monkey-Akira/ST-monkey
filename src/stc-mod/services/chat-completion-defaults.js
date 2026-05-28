/**
 * SillyTavernchat Module - Chat Completion Defaults
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDataRoot } from '../config.js';

export const monkeyApiUrl = 'https://monkeyapi.apimonkey.online/v1';

export function applyMonkeyApiDefaults(handle) {
    const userRoot = path.join(getDataRoot(), handle);
    let changed = false;

    changed = updateJsonFile(path.join(userRoot, 'settings.json'), (settings) => {
        settings.main_api = 'openai';
        settings.oai_settings ??= settings.openai_settings ?? {};
        settings.oai_settings.chat_completion_source = 'custom';
        settings.oai_settings.custom_url = monkeyApiUrl;
        if (settings.openai_settings) {
            settings.openai_settings.chat_completion_source = 'custom';
            settings.openai_settings.custom_url = monkeyApiUrl;
        }
    }) || changed;

    changed = updateJsonFile(path.join(userRoot, 'OpenAI Settings', 'Default.json'), (preset) => {
        preset.chat_completion_source = 'custom';
        preset.custom_url = monkeyApiUrl;
    }) || changed;

    if (changed) {
        console.log(`[STC-MOD] Applied Monkey API chat completion defaults for user: ${handle}`);
    }

    return changed;
}

function updateJsonFile(filePath, mutate) {
    if (!fs.existsSync(filePath)) return false;

    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const before = JSON.stringify(json);
    mutate(json);

    if (JSON.stringify(json) === before) return false;

    fs.writeFileSync(filePath, `${JSON.stringify(json, null, 4)}\n`, 'utf8');
    return true;
}
