/**
 * SillyTavernchat Module - System Monitor Service
 * Provides CPU, memory, disk usage monitoring.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { getStcDataDir, getDataRoot } from '../config.js';

const HISTORY_FILE = 'system-monitor-history.json';
const MAX_HISTORY_POINTS = 288; // 24h at 5min intervals

let lastCpuInfo = null;

function getCpuUsage() {
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    for (const cpu of cpus) {
        for (const type in cpu.times) totalTick += cpu.times[type];
        totalIdle += cpu.times.idle;
    }
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;

    if (lastCpuInfo) {
        const idleDiff = idle - lastCpuInfo.idle;
        const totalDiff = total - lastCpuInfo.total;
        lastCpuInfo = { idle, total };
        return totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
    }
    lastCpuInfo = { idle, total };
    return 0;
}

function getMemoryUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
        total: Math.round(total / 1024 / 1024),
        used: Math.round(used / 1024 / 1024),
        free: Math.round(free / 1024 / 1024),
        percent: Math.round((used / total) * 100),
    };
}

function getDiskUsage() {
    try {
        const dataRoot = getDataRoot();
        const stats = fs.statfsSync(dataRoot);
        const total = stats.blocks * stats.bsize;
        const free = stats.bfree * stats.bsize;
        const used = total - free;
        return {
            total: Math.round(total / 1024 / 1024 / 1024 * 100) / 100,
            used: Math.round(used / 1024 / 1024 / 1024 * 100) / 100,
            free: Math.round(free / 1024 / 1024 / 1024 * 100) / 100,
            percent: Math.round((used / total) * 100),
        };
    } catch {
        return { total: 0, used: 0, free: 0, percent: 0 };
    }
}

export function getSystemLoad() {
    return {
        timestamp: Date.now(),
        cpu: getCpuUsage(),
        memory: getMemoryUsage(),
        disk: getDiskUsage(),
        uptime: Math.round(os.uptime()),
        loadAvg: os.loadavg(),
        platform: os.platform(),
        hostname: os.hostname(),
        nodeVersion: process.version,
    };
}

export function getHistoryPath() {
    return path.join(getStcDataDir(), HISTORY_FILE);
}

export function loadHistory() {
    const filePath = getHistoryPath();
    if (!fs.existsSync(filePath)) return [];
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return []; }
}

export function recordSnapshot() {
    const snapshot = getSystemLoad();
    const history = loadHistory();
    history.push(snapshot);
    while (history.length > MAX_HISTORY_POINTS) history.shift();
    try { fs.writeFileSync(getHistoryPath(), JSON.stringify(history), 'utf8'); }
    catch (e) { console.error('[STC-MOD] Failed to save monitor history:', e.message); }
    return snapshot;
}

let monitorInterval = null;

export function startMonitoring(intervalMs = 300000) {
    if (monitorInterval) return;
    recordSnapshot();
    monitorInterval = setInterval(recordSnapshot, intervalMs);
    monitorInterval.unref();
    console.log('[STC-MOD] System monitoring started');
}

export function stopMonitoring() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }
}
