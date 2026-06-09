#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const modRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(process.argv[2] || '');
const monkeyApiUrl = 'https://monkeyapi.apimonkey.online/v1';

if (!target) {
    fail('Usage: node scripts/install.mjs /path/to/SillyTavern');
}

if (!fs.existsSync(path.join(target, 'package.json')) || !fs.existsSync(path.join(target, 'src'))) {
    fail(`Target does not look like a SillyTavern project: ${target}`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.join(target, 'stc-mod-backups', stamp);

log(`Target: ${target}`);
log(`Backup directory: ${backupRoot}`);

copyDirectory(path.join(modRoot, 'src', 'stc-mod'), path.join(target, 'src', 'stc-mod'));
copyDirectory(
    path.join(modRoot, 'public', 'scripts', 'extensions', 'third-party', 'stc-admin-panel'),
    path.join(target, 'public', 'scripts', 'extensions', 'third-party', 'stc-admin-panel'),
);

const coreFiles = [
    'src/server-main.js',
    'src/endpoints/secrets.js',
    'src/endpoints/avatars.js',
    'public/scripts/user.js',
    'public/scripts/secrets.js',
    'public/scripts/personas.js',
];

for (const rel of coreFiles) {
    const source = path.join(modRoot, 'patches', 'core-files', ...rel.split('/'));
    const destination = path.join(target, ...rel.split('/'));
    if (!fs.existsSync(source)) {
        fail(`Missing patch file: ${source}`);
    }
    backupAndCopy(source, destination, rel);
}

const targetDefaultConfig = path.join(target, 'default', 'config.yaml');
const patchDefaultConfig = path.join(modRoot, 'patches', 'default-config.yaml');
if (fs.existsSync(patchDefaultConfig) && fs.existsSync(targetDefaultConfig)) {
    backupAndCopy(patchDefaultConfig, targetDefaultConfig, 'default/config.yaml');
}

const targetConfig = path.join(target, 'config.yaml');
if (!fs.existsSync(targetConfig)) {
    fs.copyFileSync(path.join(target, 'default', 'config.yaml'), targetConfig);
    log('Created config.yaml from default/config.yaml');
} else {
    backupFile(targetConfig, 'config.yaml');
    mergeConfigText(targetConfig);
}

configureDefaultChatCompletion();

ensurePackageDependency('nodemailer', '^8.0.1');
ensurePackageDependency('yaml', '^2.8.3');

log('Installation files copied.');
log('Core SillyTavern files were replaced with STC-MOD compatible files and originals were backed up.');

function ensurePackageDependency(name, version) {
    const packagePath = path.join(target, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    pkg.dependencies ??= {};
    if (!pkg.dependencies[name]) {
        pkg.dependencies[name] = version;
        fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 4)}\n`, 'utf8');
        log(`Added package dependency: ${name}@${version}`);
    }
}

function configureDefaultChatCompletion() {
    const settingsPath = path.join(target, 'default', 'content', 'settings.json');
    updateJsonFile(settingsPath, 'default/content/settings.json', (settings) => {
        settings.main_api = 'openai';
        settings.oai_settings ??= settings.openai_settings ?? {};
        settings.oai_settings.chat_completion_source = 'custom';
        settings.oai_settings.custom_url = monkeyApiUrl;
        if (settings.openai_settings) {
            settings.openai_settings.chat_completion_source = 'custom';
            settings.openai_settings.custom_url = monkeyApiUrl;
        }
    });

    const openAiDefaultPresetPath = path.join(target, 'default', 'content', 'presets', 'openai', 'Default.json');
    updateJsonFile(openAiDefaultPresetPath, 'default/content/presets/openai/Default.json', (preset) => {
        preset.chat_completion_source = 'custom';
        preset.custom_url = monkeyApiUrl;
    });
}

function updateJsonFile(filePath, rel, mutate) {
    if (!fs.existsSync(filePath)) {
        log(`Skipped missing ${rel}`);
        return;
    }

    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const before = JSON.stringify(json);
    mutate(json);
    const after = JSON.stringify(json);

    if (before === after) {
        log(`${rel} already has STC-MOD chat completion defaults`);
        return;
    }

    backupFile(filePath, rel);
    fs.writeFileSync(filePath, `${JSON.stringify(json, null, 4)}\n`, 'utf8');
    log(`Configured ${rel} to use Monkey API chat completion defaults`);
}

function ensureNestedYamlBoolean(text, section, key, value) {
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const sectionPattern = new RegExp(`^${section}:\\s*(?:#.*)?$`);
    const sectionIndex = lines.findIndex(line => sectionPattern.test(line));

    if (sectionIndex === -1) {
        return { text: `${text.replace(/\s*$/, '')}${newline}${newline}${section}:${newline}  ${key}: ${value}${newline}`, changed: true };
    }

    let sectionEnd = lines.length;
    for (let i = sectionIndex + 1; i < lines.length; i++) {
        if (lines[i].trim() && /^\S/.test(lines[i])) {
            sectionEnd = i;
            break;
        }
    }

    const keyPattern = new RegExp(`^(\\s*)${key}:\\s*(true|false)(\\s*(?:#.*)?)?$`);
    for (let i = sectionIndex + 1; i < sectionEnd; i++) {
        const match = lines[i].match(keyPattern);
        if (!match) continue;

        const nextLine = `${match[1] || '  '}${key}: ${value}${match[3] || ''}`;
        if (lines[i] === nextLine) return { text, changed: false };

        lines[i] = nextLine;
        return { text: lines.join(newline), changed: true };
    }

    lines.splice(sectionIndex + 1, 0, `  ${key}: ${value}`);
    return { text: lines.join(newline), changed: true };
}

function mergeConfigText(configPath) {
    let text = fs.readFileSync(configPath, 'utf8');
    let changed = false;

    const replacements = [
        [/^listen:\s*false$/m, 'listen: true'],
        [/^whitelistMode:\s*true$/m, 'whitelistMode: false'],
        [/^basicAuthMode:\s*true$/m, 'basicAuthMode: false'],
        [/^enableUserAccounts:\s*false$/m, 'enableUserAccounts: true'],
        [/^enableDiscreetLogin:\s*false$/m, 'enableDiscreetLogin: true'],
    ];

    for (const [pattern, value] of replacements) {
        if (pattern.test(text)) {
            text = text.replace(pattern, value);
            changed = true;
        }
    }

    const extensionsConfig = ensureNestedYamlBoolean(text, 'extensions', 'enabled', true);
    text = extensionsConfig.text;
    changed = extensionsConfig.changed || changed;

    if (!/^enableInvitationCodes:/m.test(text)) {
        text += `

# -- STC-MOD CONFIGURATION --
enableInvitationCodes: false
enableForum: true
enablePublicCharacters: true
purchaseLink: ''

oauth:
  github:
    enabled: false
    clientId: ''
    clientSecret: ''
    callbackUrl: ''
  discord:
    enabled: false
    clientId: ''
    clientSecret: ''
    callbackUrl: ''
  linuxdo:
    enabled: false
    clientId: ''
    clientSecret: ''
    callbackUrl: ''

email:
  enabled: false
  smtp:
    host: ''
    port: 587
    secure: false
    user: ''
    password: ''
  from: ''
  fromName: 'SillyTavern'
  siteUrl: ''

userStorage:
  enabled: true
  defaultLimitMiB: 500
  dailyCheckInMiB: 0

privacy:
  secretsVault:
    requireForApiKeys: true
    unlockTtlMinutes: 1440
`;
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(configPath, text, 'utf8');
        log('Merged STC-MOD defaults into config.yaml');
    } else {
        log('config.yaml already contains STC-MOD keys');
    }
}

function backupAndCopy(source, destination, rel) {
    if (fs.existsSync(destination)) {
        backupFile(destination, rel);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    log(`Patched ${rel}`);
}

function backupFile(file, rel) {
    const backup = path.join(backupRoot, ...rel.split('/'));
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(file, backup);
}

function copyDirectory(source, destination) {
    if (!fs.existsSync(source)) {
        fail(`Missing source directory: ${source}`);
    }
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
    log(`Copied ${path.relative(modRoot, source)} -> ${path.relative(target, destination)}`);
}

function log(message) {
    console.log(`[STC-MOD] ${message}`);
}

function fail(message) {
    console.error(`[STC-MOD] ERROR: ${message}`);
    process.exit(1);
}
