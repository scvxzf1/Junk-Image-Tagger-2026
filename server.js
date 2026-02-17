import express from "express";
import fetch from "node-fetch";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isPkg = Boolean(process.pkg);
const runtimeRoot = isPkg ? path.dirname(process.execPath) : __dirname;

const app = express();
const PORT = process.env.PORT || 30101;
const DATA_PATH = path.join(runtimeRoot, "data.json");
const PACKAGED_DATA_PATH = path.join(__dirname, "data.default.json");

function defaultState() {
  return {
    channels: [],
    groups: [],
    scheduleGroups: [],
    tags: {},
    globalRules: { minChars: 200, maxChars: 200, autoRetry: true },
    prompts: { system: [], user: [] },
    previewResults: [],
    labelLogs: []
  };
}

async function ensureDataFile() {
  if (!isPkg) return;
  try {
    await fs.access(DATA_PATH);
    return;
  } catch {
    // continue
  }
  try {
    const raw = await fs.readFile(PACKAGED_DATA_PATH, "utf8");
    await fs.writeFile(DATA_PATH, raw, "utf8");
  } catch {
    await fs.writeFile(DATA_PATH, JSON.stringify(defaultState(), null, 2), "utf8");
  }
}

// ========== 日志工具 ==========
let requestCounter = 0;
const activeRequests = new Map();

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const dataStr = Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${timestamp}] [${level}] ${message}${dataStr}`);
}

function logRequest(req, reqId) {
  const method = req.method;
  const url = req.originalUrl || req.url;
  log('REQ', `#${reqId} ${method} ${url}`, {
    body: req.body ? Object.keys(req.body) : undefined
  });
}

function logResponse(reqId, statusCode, durationMs, extra = {}) {
  log('RES', `#${reqId} ${statusCode} (${durationMs}ms)`, extra);
}

// 请求日志中间件
app.use((req, res, next) => {
  const reqId = ++requestCounter;
  const startTime = Date.now();
  req.reqId = reqId;

  activeRequests.set(reqId, {
    url: req.originalUrl || req.url,
    method: req.method,
    startTime
  });

  logRequest(req, reqId);

  // 定期打印活跃请求数
  if (activeRequests.size > 1) {
    log('INFO', `当前活跃请求数: ${activeRequests.size}`, {
      requests: Array.from(activeRequests.entries()).map(([id, r]) => `#${id} ${r.method} ${r.url}`)
    });
  }

  const originalSend = res.send.bind(res);
  res.send = function(body) {
    const durationMs = Date.now() - startTime;
    activeRequests.delete(reqId);
    logResponse(reqId, res.statusCode, durationMs);
    return originalSend(body);
  };

  const originalJson = res.json.bind(res);
  res.json = function(body) {
    const durationMs = Date.now() - startTime;
    activeRequests.delete(reqId);
    logResponse(reqId, res.statusCode, durationMs, {
      ok: body?.ok,
      error: body?.error
    });
    return originalJson(body);
  };

  next();
});

app.use(express.json({ limit: "80mb" }));
app.use(express.static(path.join(__dirname, "public")));

async function loadState() {
  try {
    const raw = await fs.readFile(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      scheduleGroups: Array.isArray(parsed.scheduleGroups) ? parsed.scheduleGroups : [],
      tags: parsed.tags && typeof parsed.tags === "object" ? parsed.tags : {},
      globalRules: parsed.globalRules || { minChars: 200, maxChars: 200, autoRetry: true },
      prompts: parsed.prompts || { system: [], user: [] },
      previewResults: Array.isArray(parsed.previewResults) ? parsed.previewResults : [],
      labelLogs: Array.isArray(parsed.labelLogs) ? parsed.labelLogs : []
    };
  } catch (err) {
    return defaultState();
  }
}

async function saveState(nextState) {
  const payload = JSON.stringify(nextState, null, 2);
  await fs.writeFile(DATA_PATH, payload, "utf8");
}

function buildConfigOverview(currentState) {
  const channels = Array.isArray(currentState?.channels) ? currentState.channels : [];
  const groups = Array.isArray(currentState?.groups) ? currentState.groups : [];
  const scheduleGroups = Array.isArray(currentState?.scheduleGroups) ? currentState.scheduleGroups : [];
  const prompts = currentState?.prompts && typeof currentState.prompts === "object" ? currentState.prompts : {};
  const tags = currentState?.tags && typeof currentState.tags === "object" ? currentState.tags : {};
  const labelLogs = Array.isArray(currentState?.labelLogs) ? currentState.labelLogs : [];

  const systemPrompts = Array.isArray(prompts.system) ? prompts.system : [];
  const userPrompts = Array.isArray(prompts.user) ? prompts.user : [];

  return {
    counts: {
      channels: channels.length,
      groups: groups.length,
      scheduleGroups: scheduleGroups.length,
      prompts: {
        system: systemPrompts.length,
        user: userPrompts.length,
        total: systemPrompts.length + userPrompts.length
      },
      tags: Object.keys(tags).length,
      logs: labelLogs.length
    },
    globalRules: {
      minChars: Number.isFinite(currentState?.globalRules?.minChars) ? currentState.globalRules.minChars : 200,
      maxChars: Number.isFinite(currentState?.globalRules?.maxChars) ? currentState.globalRules.maxChars : 200,
      autoRetry: currentState?.globalRules?.autoRetry !== false
    }
  };
}

function buildConfigDiagnostics(currentState) {
  const channels = Array.isArray(currentState?.channels) ? currentState.channels : [];
  const scheduleGroups = Array.isArray(currentState?.scheduleGroups) ? currentState.scheduleGroups : [];
  const globalRules = currentState?.globalRules || { minChars: 200, maxChars: 200, autoRetry: true };
  const channelIdSet = new Set(channels.map((channel) => channel?.id).filter(Boolean));
  const items = [];

  channels.forEach((channel) => {
    const channelName = channel?.name || "未命名渠道";
    if (!channel?.apiUrl || !String(channel.apiUrl).trim()) {
      items.push({
        level: "warning",
        code: "CHANNEL_API_URL_MISSING",
        message: `渠道「${channelName}」缺少 apiUrl。`,
        location: { channelId: channel?.id || null }
      });
    }
    const apiKeys = Array.isArray(channel?.apiKeys) ? channel.apiKeys.map((key) => String(key || "").trim()).filter(Boolean) : [];
    if (apiKeys.length === 0) {
      items.push({
        level: "warning",
        code: "CHANNEL_API_KEYS_MISSING",
        message: `渠道「${channelName}」缺少可用 apiKeys。`,
        location: { channelId: channel?.id || null }
      });
    }
  });

  scheduleGroups.forEach((group) => {
    const groupName = group?.name || "未命名调度组";
    const steps = Array.isArray(group?.steps) ? group.steps : [];
    steps.forEach((step, stepIndex) => {
      const channelId = step?.channelId;
      if (!channelId || !channelIdSet.has(channelId)) {
        items.push({
          level: "error",
          code: "STEP_CHANNEL_NOT_FOUND",
          message: `调度组「${groupName}」第 ${stepIndex + 1} 步引用了不存在的 channel。`,
          location: { scheduleGroupId: group?.id || null, stepIndex }
        });
      }
      if (!step?.model || !String(step.model).trim()) {
        items.push({
          level: "warning",
          code: "STEP_MODEL_MISSING",
          message: `调度组「${groupName}」第 ${stepIndex + 1} 步缺少 model。`,
          location: { scheduleGroupId: group?.id || null, stepIndex }
        });
      }
    });
  });

  const minChars = Number(globalRules?.minChars);
  const maxChars = Number(globalRules?.maxChars);
  if (Number.isFinite(minChars) && Number.isFinite(maxChars) && minChars > maxChars) {
    items.push({
      level: "error",
      code: "GLOBAL_RULES_RANGE_INVALID",
      message: `globalRules.minChars (${minChars}) 大于 maxChars (${maxChars})。`,
      location: { field: "globalRules" }
    });
  }

  if (items.length === 0) {
    items.push({
      level: "info",
      code: "CONFIG_CHECK_PASSED",
      message: "未发现配置一致性问题。",
      location: null
    });
  }

  const summary = {
    error: items.filter((item) => item.level === "error").length,
    warning: items.filter((item) => item.level === "warning").length,
    info: items.filter((item) => item.level === "info").length
  };

  return {
    summary: {
      ...summary,
      total: items.length
    },
    items
  };
}

await ensureDataFile();
let appState = await loadState();
const channelKeyIndex = new Map();

function normalizeBaseUrl(apiUrl) {
  if (!apiUrl) return "";
  const trimmed = apiUrl.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/v1$/i, "");
}

async function forwardJson(url, apiKey, body, timeoutMs = 0) {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey ? `Bearer ${apiKey}` : ""
    },
    signal: controller ? controller.signal : undefined,
    body: JSON.stringify(body)
  });
  if (timer) clearTimeout(timer);
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: resp.status, json };
}

function getNextApiKey(channel) {
  const keys = Array.isArray(channel.apiKeys) ? channel.apiKeys.filter(Boolean) : [];
  if (keys.length === 0) return "";
  const current = channelKeyIndex.get(channel.id) ?? 0;
  const next = current % keys.length;
  channelKeyIndex.set(channel.id, (next + 1) % keys.length);
  return keys[next];
}

function extractContent(respJson) {
  const content = respJson?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  return "";
}

function applyInject(group, payload) {
  const messages = Array.isArray(payload.messages) ? [...payload.messages] : [];
  const systemText = group.systemInjectText || group.injectText || "";
  const userText = group.userInjectText || "";
  if (systemText) {
    const systemMsg = { role: "system", content: systemText };
    if (group.systemInject === "back") {
      messages.push(systemMsg);
    } else {
      messages.unshift(systemMsg);
    }
  }
  if (userText) {
    const userMsg = { role: "user", content: userText };
    if (group.userInject === "back") {
      messages.push(userMsg);
    } else {
      messages.unshift(userMsg);
    }
  }
  return { ...payload, messages };
}

function isImageFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"].includes(ext);
}

function tagTextPathForImage(imagePath) {
  if (!imagePath) return "";
  const dir = path.dirname(imagePath);
  const base = path.basename(imagePath, path.extname(imagePath));
  return path.join(dir, `${base}.txt`);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

function extractFilePathFromUrl(imageUrl) {
  if (!imageUrl) return "";
  try {
    const url = new URL(imageUrl, "http://localhost");
    if (url.pathname !== "/api/file") return "";
    const raw = url.searchParams.get("path") || "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  } catch {
    return "";
  }
}

function normalizeFsPath(inputPath) {
  if (typeof inputPath !== "string") return "";
  const trimmed = inputPath.trim();
  if (!trimmed) return "";
  return path.resolve(trimmed);
}

async function resolveDirectoryPath(primaryPath, fallbackPath = "") {
  const tried = [];
  const candidates = [primaryPath, fallbackPath];
  for (const candidate of candidates) {
    const normalized = normalizeFsPath(candidate);
    if (!normalized) continue;
    if (tried.some((item) => item.path === normalized)) continue;
    try {
      const stat = await fs.stat(normalized);
      if (stat.isDirectory()) {
        return { path: normalized, tried };
      }
      tried.push({ path: normalized, code: "ENOTDIR" });
    } catch (err) {
      tried.push({ path: normalized, code: err?.code || "ERR" });
    }
  }
  return { path: "", tried };
}

// ==========================================
// 1. 先是 /api/models 接口 (不要动里面的内容)
// ==========================================
app.post("/api/models", async (req, res) => {
  const { apiUrl, apiKey } = req.body || {};
  const baseUrl = normalizeBaseUrl(apiUrl);
  if (!baseUrl) {
    return res.status(400).json({ error: "Missing apiUrl" });
  }
  try {
    const endpoints = [
      `${baseUrl}/v1/models`,
      `${baseUrl}/models`
    ];
    const headers = apiKey
      ? { Authorization: `Bearer ${apiKey}` }
      : {};

    let lastStatus = 500;
    let lastJson = { error: "Model fetch failed" };

    for (const endpoint of endpoints) {
      const resp = await fetch(endpoint, { headers });
      const text = await resp.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      if (resp.ok) {
        return res.status(resp.status).json(json);
      }

      lastStatus = resp.status;
      lastJson = json;

      if (![404, 405].includes(resp.status)) {
        return res.status(resp.status).json(json);
      }
    }

    return res.status(lastStatus).json(lastJson);
  } catch (err) {
    res.status(500).json({ error: "Model fetch failed", detail: String(err) });
  }
});

function runDialogCommand(command, args) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
        timeout: 5 * 60 * 1000,
        maxBuffer: 1024 * 1024
      },
      (error, stdout = "", stderr = "") => {
        if (error) {
          if (error.code === "ENOENT") {
            return resolve({ status: "not_found", stdout, stderr });
          }
          return resolve({
            status: "failed",
            code: error.code,
            stdout,
            stderr,
            detail: String(error.message || error)
          });
        }
        resolve({ status: "ok", stdout, stderr });
      }
    );
  });
}

function extractSelectedPath(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : "";
}

function compactDialogError(raw) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "failed";
  const picked = lines.find(
    (line) => !line.startsWith("Traceback") && !line.startsWith("File ")
  ) || lines[0];
  const compact = picked.replace(/\s+/g, " ");
  if (compact.length <= 180) return compact;
  return `${compact.slice(0, 177)}...`;
}

function looksLikeCancel(platform, runResult) {
  if (!runResult || runResult.status !== "failed") return false;
  const exitCode = Number(runResult.code);
  const msg = `${runResult.stdout || ""}\n${runResult.stderr || ""}`.toLowerCase();

  if (platform === "darwin") {
    return msg.includes("user canceled") || msg.includes("user cancelled");
  }
  if (platform === "linux") {
    if (exitCode !== 1) return false;
    if (!msg.trim()) return true;
    if (msg.includes("cancel")) return true;
    if (msg.includes("cannot open display") || msg.includes("display")) return false;
    if (msg.includes("error") || msg.includes("failed")) return false;
    return true;
  }
  return false;
}

function folderDialogCandidates(platform) {
  if (platform === "darwin") {
    return [
      {
        command: "osascript",
        args: ["-e", "POSIX path of (choose folder with prompt \"请选择文件夹\")"]
      }
    ];
  }

  if (platform === "win32") {
    const script = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$d.ShowNewFolderButton = $false",
      "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($d.SelectedPath) }"
    ].join("; ");
    return [
      {
        command: "powershell",
        args: ["-NoProfile", "-STA", "-Command", script]
      },
      {
        command: "pwsh",
        args: ["-NoProfile", "-STA", "-Command", script]
      }
    ];
  }

  if (platform === "linux") {
    return [
      {
        command: "zenity",
        args: ["--file-selection", "--directory", "--title=选择文件夹"]
      },
      {
        command: "kdialog",
        args: ["--getexistingdirectory", ".", "--title", "选择文件夹"]
      },
      {
        command: "python3",
        args: [
          "-c",
          "import tkinter as tk; from tkinter import filedialog; root=tk.Tk(); root.withdraw(); root.attributes('-topmost', True); p=filedialog.askdirectory(); print(p, end='')"
        ]
      }
    ];
  }

  return [];
}

async function selectFolderByPlatform() {
  const platform = process.platform;
  const candidates = folderDialogCandidates(platform);
  if (candidates.length === 0) {
    return {
      path: null,
      error: `Unsupported platform: ${platform}`
    };
  }

  const errors = [];
  for (const candidate of candidates) {
    const result = await runDialogCommand(candidate.command, candidate.args);

    if (result.status === "not_found") {
      errors.push(`${candidate.command}: not found`);
      continue;
    }

    if (result.status === "ok") {
      const selectedPath = extractSelectedPath(result.stdout);
      if (!selectedPath) {
        return { path: null, canceled: true };
      }
      return { path: selectedPath };
    }

    if (looksLikeCancel(platform, result)) {
      return { path: null, canceled: true };
    }

    const detail = compactDialogError(result.stderr || result.detail || "failed");
    errors.push(`${candidate.command}: ${detail}`);
  }

  return {
    path: null,
    error: errors.length > 0
      ? `No available folder picker. ${errors.join(" | ")}`
      : "No available folder picker"
  };
}

app.get('/api/select-folder', async (req, res) => {
  const result = await selectFolderByPlatform();
  if (result.error) {
    log('WARN', 'Select folder failed', {
      platform: process.platform,
      error: result.error
    });
  }
  res.json(result);
});

app.post("/api/images", async (req, res) => {
  const { path: dirPath, note: dirNote } = req.body || {};
  if (!dirPath && !dirNote) {
    return res.status(400).json({ error: "Missing path" });
  }
  const resolved = await resolveDirectoryPath(dirPath, dirNote);
  const normalizedDirPath = resolved.path;
  if (!normalizedDirPath) {
    const triedPathText = resolved.tried.map((item) => item.path).join(" | ");
    return res.status(400).json({
      error: "Directory not found",
      detail: triedPathText ? `Tried: ${triedPathText}` : "No valid directory path"
    });
  }
  try {
    const entries = await fs.readdir(normalizedDirPath, { withFileTypes: true });
    const images = entries
      .filter((entry) => entry.isFile() && isImageFile(entry.name))
      .map((entry) => {
        const fullPath = path.join(normalizedDirPath, entry.name);
        return {
          name: entry.name,
          path: fullPath,
          url: `/api/file?path=${encodeURIComponent(fullPath)}`
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }));
    res.json({ ok: true, images });
  } catch (err) {
    res.status(500).json({ error: "Read images failed", detail: String(err) });
  }
});

app.post("/api/tag-results", async (req, res) => {
  const { path: dirPath, note: dirNote } = req.body || {};
  if (!dirPath) {
    return res.status(400).json({ error: "Missing path" });
  }
  const resolved = await resolveDirectoryPath(dirPath, dirNote);
  const normalizedDirPath = resolved.path;
  if (!normalizedDirPath) {
    const triedPathText = resolved.tried.map((item) => item.path).join(" | ");
    return res.status(400).json({
      error: "Directory not found",
      detail: triedPathText ? `Tried: ${triedPathText}` : "No valid directory path"
    });
  }
  try {
    const entries = await fs.readdir(normalizedDirPath, { withFileTypes: true });
    const images = entries
      .filter((entry) => entry.isFile() && isImageFile(entry.name))
      .map((entry) => {
      const fullPath = path.join(normalizedDirPath, entry.name);
      const textPath = tagTextPathForImage(fullPath);
      return {
        name: entry.name,
        imagePath: fullPath,
        imageUrl: `/api/file?path=${encodeURIComponent(fullPath)}`,
        textPath
      };
    })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }));
    const results = [];
    for (const item of images) {
      let text = "";
      let textLength = 0;
      try {
        text = await fs.readFile(item.textPath, "utf8");
        textLength = text.trim().length;
      } catch {
        text = "";
        textLength = 0;
      }
      results.push({ ...item, text, textLength });
    }
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: "Read tag results failed", detail: String(err) });
  }
});

app.post("/api/tag-save", async (req, res) => {
  const { imagePath, textPath, text } = req.body || {};
  const targetPath = normalizeFsPath(textPath || tagTextPathForImage(imagePath));
  if (!targetPath) {
    return res.status(400).json({ error: "Missing textPath" });
  }
  try {
    await fs.writeFile(targetPath, String(text || ""), "utf8");
    res.json({ ok: true, textPath: targetPath });
  } catch (err) {
    res.status(500).json({ error: "Save tag failed", detail: String(err) });
  }
});

app.get("/api/file", async (req, res) => {
  const filePath = req.query.path;
  if (!filePath || typeof filePath !== "string") {
    return res.status(400).json({ error: "Missing path" });
  }
  const normalizedPath = normalizeFsPath(filePath);
  if (!normalizedPath) {
    return res.status(400).json({ error: "Invalid path" });
  }
  try {
    const stat = await fs.stat(normalizedPath);
    if (!stat.isFile()) {
      return res.status(404).json({ error: "Not found" });
    }
    res.setHeader("Content-Type", contentTypeFor(normalizedPath));
    res.sendFile(normalizedPath);
  } catch (err) {
    res.status(500).json({ error: "Read file failed", detail: String(err) });
  }
});

app.post("/api/save-results", async (req, res) => {
  const { targetPath, targetNote, results } = req.body || {};
  if (!targetPath && !targetNote) {
    return res.status(400).json({ error: "Missing targetPath" });
  }
  if (!Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: "Missing results" });
  }
  const rawTargetPath = typeof targetPath === "string" ? targetPath.trim() : "";
  const rawTargetNote = typeof targetNote === "string" ? targetNote.trim() : "";
  const targetIsAbsolute = rawTargetPath ? path.isAbsolute(rawTargetPath) : false;
  const noteIsAbsolute = rawTargetNote ? path.isAbsolute(rawTargetNote) : false;

  let resolvedTargetPath = "";
  if (!targetIsAbsolute && noteIsAbsolute) {
    resolvedTargetPath = normalizeFsPath(rawTargetNote);
  } else {
    const resolved = await resolveDirectoryPath(rawTargetPath, rawTargetNote);
    resolvedTargetPath = resolved.path || normalizeFsPath(rawTargetPath || rawTargetNote || "");
  }
  if (!resolvedTargetPath) {
    return res.status(400).json({ error: "Invalid targetPath" });
  }
  try {
    await fs.mkdir(resolvedTargetPath, { recursive: true });
    const saved = [];
    for (const item of results) {
      const sourcePath = extractFilePathFromUrl(item.imageUrl);
      const baseName = sourcePath ? path.basename(sourcePath, path.extname(sourcePath)) : item.id;
      const textPath = path.join(resolvedTargetPath, `${baseName}.txt`);
      await fs.writeFile(textPath, item.text || "", "utf8");
      saved.push({ textPath, sourcePath });
    }
    const indexPath = path.join(resolvedTargetPath, "results.json");
    await fs.writeFile(indexPath, JSON.stringify(saved, null, 2), "utf8");
    res.json({ ok: true, count: saved.length, indexPath, targetPath: resolvedTargetPath });
  } catch (err) {
    res.status(500).json({ error: "Save failed", detail: String(err) });
  }
});

app.get("/api/state", (_req, res) => {
  res.json(appState);
});

app.get("/api/config/overview", (_req, res) => {
  try {
    res.json(buildConfigOverview(appState));
  } catch (err) {
    res.status(500).json({ error: "Build config overview failed", detail: String(err) });
  }
});

app.get("/api/config/diagnostics", (_req, res) => {
  try {
    res.json(buildConfigDiagnostics(appState));
  } catch (err) {
    res.status(500).json({ error: "Build config diagnostics failed", detail: String(err) });
  }
});

app.put("/api/state", async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ error: "Invalid state payload", detail: "Request body must be an object" });
  }

  const { channels, groups, scheduleGroups, tags, globalRules, prompts, previewResults, labelLogs } = req.body || {};
  appState = {
    channels: Array.isArray(channels) ? channels : [],
    groups: Array.isArray(groups) ? groups : [],
    scheduleGroups: Array.isArray(scheduleGroups) ? scheduleGroups : [],
    tags: tags && typeof tags === "object" ? tags : {},
    globalRules: {
      minChars: Number.isFinite(globalRules?.minChars) ? globalRules.minChars : 200,
      maxChars: Number.isFinite(globalRules?.maxChars) ? globalRules.maxChars : 200,
      autoRetry: globalRules?.autoRetry !== false
    },
    prompts: {
      system: Array.isArray(prompts?.system) ? prompts.system : [],
      user: Array.isArray(prompts?.user) ? prompts.user : []
    },
    previewResults: Array.isArray(previewResults) ? previewResults : [],
    labelLogs: Array.isArray(labelLogs) ? labelLogs : []
  };
  try {
    await saveState(appState);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Save failed", detail: String(err) });
  }
});

app.post("/api/dispatch", async (req, res) => {
  const reqId = req.reqId;
  const dispatchStart = Date.now();

  const {
    scheduleGroupId,
    payload,
    minChars,
    maxChars,
    autoRetry
  } = req.body || {};

  log('DISPATCH', `#${reqId} 开始调度`, { scheduleGroupId });

  const group = appState.scheduleGroups.find((item) => item.id === scheduleGroupId);
  if (!group) {
    log('DISPATCH', `#${reqId} 调度组未找到`, { scheduleGroupId });
    return res.status(404).json({ error: "Schedule group not found" });
  }
  if (!payload || typeof payload !== "object") {
    log('DISPATCH', `#${reqId} payload 缺失`);
    return res.status(400).json({ error: "Missing payload" });
  }

  const steps = (group.steps || []).filter((step) => step.enabled !== false);
  if (steps.length === 0) {
    log('DISPATCH', `#${reqId} 无启用的步骤`);
    return res.status(400).json({ error: "No enabled steps" });
  }

  log('DISPATCH', `#${reqId} 调度组: ${group.name}`, {
    stepsCount: steps.length,
    steps: steps.map(s => ({ model: s.model, retries: s.retries, timeoutSec: s.timeoutSec }))
  });

  const rules = appState.globalRules || { minChars: 200, maxChars: 200, autoRetry: true };
  const minLen = Number.isFinite(minChars) ? minChars : rules.minChars;
  const maxLen = Number.isFinite(maxChars) ? maxChars : rules.maxChars;
  const shouldRetry = autoRetry === undefined ? rules.autoRetry : autoRetry;

  const errors = [];

  const attemptLogs = [];
  for (const [stepIndex, step] of steps.entries()) {
    const channel = appState.channels.find((item) => item.id === step.channelId);
    if (!channel) {
      log('DISPATCH', `#${reqId} 步骤${stepIndex} 渠道缺失`, { channelId: step.channelId });
      errors.push({ step, error: "Channel missing" });
      if (!shouldRetry) break;
      continue;
    }
    const apiUrl = normalizeBaseUrl(channel.apiUrl);
    if (!apiUrl) {
      log('DISPATCH', `#${reqId} 步骤${stepIndex} apiUrl缺失`);
      errors.push({ step, error: "Channel apiUrl missing" });
      if (!shouldRetry) break;
      continue;
    }

    const retries = Number.isFinite(step.retries) ? step.retries : 0;
    const intervalMs = (Number.isFinite(step.interval) ? step.interval : 0) * 1000;
    const timeoutSec =
      Number.isFinite(step.timeoutSec) && step.timeoutSec > 0
        ? step.timeoutSec
        : Number.isFinite(group.timeoutSec) && group.timeoutSec > 0
          ? group.timeoutSec
          : 60;
    const attempts = Math.max(1, retries + 1);

    log('DISPATCH', `#${reqId} 步骤${stepIndex} 开始`, {
      channel: channel.name,
      model: step.model,
      retries,
      timeoutSec,
      maxAttempts: attempts
    });

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const model = step.model || payload.model;
      const mergedPayload = applyInject(group, { ...payload, model });
      const attemptStarted = Date.now();

      log('API_CALL', `#${reqId} 步骤${stepIndex} 尝试${attempt}/${attempts} 开始调用API`, {
        channel: channel.name,
        model,
        apiUrl: `${apiUrl}/v1/chat/completions`,
        timeoutSec
      });

      try {
        const apiKey = getNextApiKey(channel);
        const { status, json } = await forwardJson(
          `${apiUrl}/v1/chat/completions`,
          apiKey,
          mergedPayload,
          timeoutSec * 1000
        );

        const apiDuration = Date.now() - attemptStarted;
        log('API_CALL', `#${reqId} 步骤${stepIndex} 尝试${attempt} API返回`, {
          status,
          durationMs: apiDuration,
          hasChoices: !!json?.choices
        });

        if (status >= 200 && status < 300) {
          const content = extractContent(json);
          const length = content.length;
          const tooShort = minLen !== null && length < minLen;
          const tooLong = maxLen !== null && length > maxLen;

          log('API_CALL', `#${reqId} 步骤${stepIndex} 尝试${attempt} 内容检查`, {
            contentLength: length,
            minLen,
            maxLen,
            tooShort,
            tooLong
          });

          if (!tooShort && !tooLong) {
            attemptLogs.push({
              stepIndex,
              channelId: channel.id,
              model,
              attempt,
              status,
              ok: true,
              length,
              durationMs: apiDuration
            });

            const totalDuration = Date.now() - dispatchStart;
            log('DISPATCH', `#${reqId} ✅ 调度成功`, {
              stepIndex,
              attempt,
              contentLength: length,
              totalDurationMs: totalDuration
            });

            return res.json({
              ok: true,
              step: { channelId: channel.id, model },
              attempt,
              response: json,
              attempts: attemptLogs
            });
          }
          attemptLogs.push({
            stepIndex,
            channelId: channel.id,
            model,
            attempt,
            status,
            ok: false,
            length,
            error: "length_rule_failed",
            durationMs: apiDuration
          });
          errors.push({
            step: { channelId: channel.id, model },
            error: "Length rule failed",
            length
          });
        } else {
          log('API_CALL', `#${reqId} 步骤${stepIndex} 尝试${attempt} HTTP错误`, {
            status,
            error: json?.error || json?.raw?.slice?.(0, 200)
          });
          attemptLogs.push({
            stepIndex,
            channelId: channel.id,
            model,
            attempt,
            status,
            ok: false,
            error: "http_error",
            detail: json,
            durationMs: apiDuration
          });
          errors.push({ step: { channelId: channel.id, model }, error: json });
        }
      } catch (err) {
        const apiDuration = Date.now() - attemptStarted;
        log('API_CALL', `#${reqId} 步骤${stepIndex} 尝试${attempt} ❌ 异常`, {
          error: String(err),
          durationMs: apiDuration
        });
        attemptLogs.push({
          stepIndex,
          channelId: channel.id,
          model,
          attempt,
          status: 0,
          ok: false,
          error: String(err),
          durationMs: apiDuration
        });
        errors.push({ step: { channelId: channel.id, model }, error: String(err) });
      }

      if (!shouldRetry) break;
      if (attempt < attempts && intervalMs > 0) {
        log('DISPATCH', `#${reqId} 步骤${stepIndex} 等待重试`, { intervalMs });
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  }

  const totalDuration = Date.now() - dispatchStart;
  log('DISPATCH', `#${reqId} ❌ 调度失败 - 所有步骤均失败`, {
    totalDurationMs: totalDuration,
    errorsCount: errors.length
  });

  res.status(502).json({ ok: false, error: "All steps failed", errors, attempts: attemptLogs });
});

app.post("/api/chat", async (req, res) => {
  const { apiUrl, apiKey, payload } = req.body || {};
  const baseUrl = normalizeBaseUrl(apiUrl);
  if (!baseUrl) {
    return res.status(400).json({ error: "Missing apiUrl" });
  }
  if (!payload) {
    return res.status(400).json({ error: "Missing payload" });
  }
  try {
    const { status, json } = await forwardJson(
      `${baseUrl}/v1/chat/completions`,
      apiKey,
      payload
    );
    res.status(status).json(json);
  } catch (err) {
    res.status(500).json({ error: "Chat call failed", detail: String(err) });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  log('INFO', `🚀 服务器启动成功`, {
    port: PORT,
    url: `http://localhost:${PORT}`,
    dataPath: DATA_PATH
  });
  log('INFO', `已加载数据`, {
    channels: appState.channels.length,
    groups: appState.groups.length,
    scheduleGroups: appState.scheduleGroups.length
  });
});
