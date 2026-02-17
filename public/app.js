const state = {
  channels: [],
  groups: [],
  scheduleGroups: [],
  tags: {},
  globalRules: { minChars: 200, maxChars: 200, autoRetry: true },
  prompts: { system: [], user: [] },
  previewResults: [],
  labelLogs: []
};

let saveTimer = null;
let needsPromptPersist = false;
let lastSaveFailed = false;

function setSaveStatus(status, message = "") {
  if (!saveStatus) return;
  saveStatus.classList.remove("save-status-saving", "save-status-saved", "save-status-failed");
  if (status === "saving") {
    saveStatus.classList.add("save-status-saving");
    saveStatus.textContent = "保存中...";
    return;
  }
  if (status === "saved") {
    saveStatus.classList.add("save-status-saved");
    saveStatus.textContent = "已保存";
    return;
  }
  if (status === "failed") {
    saveStatus.classList.add("save-status-failed");
    saveStatus.textContent = message || "保存失败，请检查服务是否运行或后端已更新。";
    return;
  }
  saveStatus.textContent = "";
}

function buildStatePayload() {
  return {
    channels: state.channels,
    groups: state.groups,
    scheduleGroups: state.scheduleGroups,
    tags: state.tags,
    globalRules: state.globalRules,
    prompts: state.prompts,
    previewResults: state.previewResults,
    labelLogs: state.labelLogs
  };
}

async function saveStateNow() {
  setSaveStatus("saving");
  try {
    const payload = buildStatePayload();
    const resp = await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      let detail = "save failed";
      try {
        const data = await resp.json();
        detail = data?.error || data?.detail || detail;
      } catch {
        // ignore parse error
      }
      throw new Error(detail);
    }
    const check = await fetch("/api/state");
    const data = await check.json();
    if (!check.ok) throw new Error("save verify failed");
    if (!data.prompts || !Array.isArray(data.prompts.system) || !Array.isArray(data.prompts.user)) {
      throw new Error("backend missing prompts");
    }
    const savedChannels = Array.isArray(data.channels) ? data.channels.length : 0;
    if (savedChannels !== payload.channels.length) {
      throw new Error(`channels persist mismatch ${savedChannels}/${payload.channels.length}`);
    }
    lastSaveFailed = false;
    if (promptSaveStatus) promptSaveStatus.textContent = "";
    setSaveStatus("saved");
    return true;
  } catch (err) {
    lastSaveFailed = true;
    const message = `保存失败：${String(err?.message || err || "请检查服务是否运行或后端已更新")}`;
    if (promptSaveStatus) {
      promptSaveStatus.textContent = message;
    }
    setSaveStatus("failed", message);
    return false;
  }
}

async function loadState() {
  try {
    const resp = await fetch("/api/state");
    const data = await resp.json();
    state.channels = Array.isArray(data.channels) ? data.channels : [];
    state.groups = Array.isArray(data.groups) ? data.groups : [];
    state.scheduleGroups = Array.isArray(data.scheduleGroups) ? data.scheduleGroups : [];
    state.tags = data.tags && typeof data.tags === "object" ? data.tags : {};
    state.globalRules = data.globalRules || { minChars: 200, maxChars: 200, autoRetry: true };
    if (data.prompts) {
      state.prompts = data.prompts;
    } else {
      state.prompts = { system: [], user: [] };
      needsPromptPersist = true;
    }
    state.previewResults = Array.isArray(data.previewResults) ? data.previewResults : [];
    state.labelLogs = Array.isArray(data.labelLogs) ? data.labelLogs : [];
  } catch {
    state.channels = [];
    state.groups = [];
    state.scheduleGroups = [];
    state.tags = {};
    state.globalRules = { minChars: 200, maxChars: 200, autoRetry: true };
    state.prompts = { system: [], user: [] };
    state.previewResults = [];
    state.labelLogs = [];
  }
}

function queueSave() {
  clearTimeout(saveTimer);
  setSaveStatus("saving");
  saveTimer = setTimeout(async () => {
    await saveStateNow();
  }, 300);
}

const navButtons = document.querySelectorAll(".nav-item");
const panels = document.querySelectorAll(".panel");

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    navButtons.forEach((item) => item.classList.remove("active"));
    panels.forEach((panel) => panel.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.target).classList.add("active");
  });
});

const channelForm = document.getElementById("channel-form");
const channelTable = document.getElementById("channel-table");
const modelChannelSelect = document.getElementById("model-channel");
const fetchModelsBtn = document.getElementById("fetch-models");
const modelList = document.getElementById("model-list");
const clearChannelsBtn = document.getElementById("clear-channels");
let editingChannelId = null;

function renderChannels() {
  channelTable.innerHTML = "";
  if (state.channels.length === 0) {
    channelTable.innerHTML = "<p class=\"muted\">暂无渠道，请先添加。</p>";
    modelChannelSelect.innerHTML = "";
    renderScheduleSteps();
    return;
  }
  const frag = document.createDocumentFragment();
  state.channels.forEach((channel) => {
    const row = document.createElement("div");
    row.className = "table-row";
    row.dataset.id = channel.id;
    if (editingChannelId === channel.id) {
      row.classList.add("is-editing");

      const editWrap = document.createElement("div");
      editWrap.className = "channel-edit";

      const nameInput = document.createElement("input");
      nameInput.className = "channel-edit-name";
      nameInput.type = "text";
      nameInput.value = channel.name || "";

      const urlInput = document.createElement("input");
      urlInput.className = "channel-edit-url";
      urlInput.type = "text";
      urlInput.value = channel.apiUrl || "";

      const keysInput = document.createElement("textarea");
      keysInput.className = "channel-edit-keys";
      keysInput.rows = 3;
      keysInput.placeholder = "每行一个 API Key";
      keysInput.value = (channel.apiKeys || []).join("\n");

      const actions = document.createElement("div");
      actions.className = "row compact";

      const saveBtn = document.createElement("button");
      saveBtn.className = "primary";
      saveBtn.dataset.action = "save";
      saveBtn.dataset.id = channel.id;
      saveBtn.textContent = "保存";

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "ghost";
      cancelBtn.dataset.action = "cancel";
      cancelBtn.dataset.id = channel.id;
      cancelBtn.textContent = "取消";

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "ghost danger";
      deleteBtn.dataset.action = "delete";
      deleteBtn.dataset.id = channel.id;
      deleteBtn.textContent = "删除";

      actions.append(saveBtn, cancelBtn, deleteBtn);

      const tip = document.createElement("p");
      tip.className = "muted";
      tip.textContent = "双击进入编辑，Enter 保存，Ctrl+Enter 保存，Esc 取消。";

      editWrap.append(nameInput, urlInput, keysInput, actions, tip);
      row.appendChild(editWrap);
    } else {
      const name = document.createElement("strong");
      name.textContent = channel.name || "";

      const url = document.createElement("span");
      url.textContent = channel.apiUrl || "";

      const keyCount = document.createElement("span");
      keyCount.textContent = `${channel.apiKeys.length} 个 Key`;

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "ghost danger";
      deleteBtn.dataset.action = "delete";
      deleteBtn.dataset.id = channel.id;
      deleteBtn.textContent = "删除";

      row.append(name, url, keyCount, deleteBtn);
    }
    frag.appendChild(row);
  });
  channelTable.appendChild(frag);

  const prevModelChannelValue = modelChannelSelect.value;
  modelChannelSelect.innerHTML = "";
  state.channels.forEach((channel) => {
    const option = document.createElement("option");
    option.value = channel.id;
    option.textContent = channel.name || "";
    option.selected = channel.id === prevModelChannelValue;
    modelChannelSelect.appendChild(option);
  });
  if (!modelChannelSelect.value && state.channels.length > 0) {
    modelChannelSelect.value = state.channels[0].id;
  }
  renderScheduleSteps();
}

channelTable.addEventListener("click", (event) => {
  const target = event.target;
  const actionBtn = target.closest("button[data-action]");
  if (!actionBtn) return;
  const action = actionBtn.dataset.action;
  const id = actionBtn.dataset.id;
  const channel = state.channels.find((item) => item.id === id);
  if (!channel) return;

  if (action === "delete") {
    state.channels = state.channels.filter((item) => item.id !== id);
    if (editingChannelId === id) editingChannelId = null;
    queueSave();
    renderChannels();
    updateChannelSelects();
    return;
  }

  if (action === "cancel") {
    editingChannelId = null;
    renderChannels();
    return;
  }

  if (action === "save") {
    const row = channelTable.querySelector(`.table-row[data-id="${id}"]`);
    if (!row) return;
    const nameInput = row.querySelector(".channel-edit-name");
    const urlInput = row.querySelector(".channel-edit-url");
    const keysInput = row.querySelector(".channel-edit-keys");
    if (!nameInput || !urlInput || !keysInput) return;
    const name = nameInput.value.trim();
    const apiUrl = urlInput.value.trim();
    const apiKeys = keysInput.value
      .split(/\n+/)
      .map((key) => key.trim())
      .filter(Boolean);
    if (!name || !apiUrl) {
      alert("渠道名和 API URL 不能为空。");
      return;
    }
    channel.name = name;
    channel.apiUrl = apiUrl;
    channel.apiKeys = apiKeys;
    editingChannelId = null;
    queueSave();
    renderChannels();
    updateChannelSelects();
  }
});

channelTable.addEventListener("dblclick", (event) => {
  const row = event.target.closest(".table-row");
  if (!row) return;
  const id = row.dataset.id;
  if (!id) return;
  if (editingChannelId && editingChannelId !== id) {
    editingChannelId = id;
  } else if (!editingChannelId) {
    editingChannelId = id;
  } else {
    const saveBtn = row.querySelector("button[data-action=\"save\"]");
    if (saveBtn) saveBtn.click();
    return;
  }
  renderChannels();
  const focusRow = channelTable.querySelector(`.table-row[data-id="${id}"]`);
  const nameInput = focusRow?.querySelector(".channel-edit-name");
  if (nameInput) {
    nameInput.focus();
    nameInput.select();
  }
});

channelTable.addEventListener("keydown", (event) => {
  if (!editingChannelId) return;
  if (event.key === "Escape") {
    editingChannelId = null;
    renderChannels();
    return;
  }
  if (event.key === "Enter") {
    const isTextarea = event.target && event.target.classList.contains("channel-edit-keys");
    if (isTextarea && !event.ctrlKey) return;
    event.preventDefault();
    const row = channelTable.querySelector(`.table-row[data-id="${editingChannelId}"]`);
    const saveBtn = row?.querySelector("button[data-action=\"save\"]");
    if (saveBtn) saveBtn.click();
  }
});

clearChannelsBtn.addEventListener("click", () => {
  state.channels = [];
  queueSave();
  renderChannels();
  updateChannelSelects();
  modelList.innerHTML = "";
});

channelForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(channelForm);
  const name = formData.get("name").trim();
  const apiUrl = formData.get("apiUrl").trim();
  const apiKeys = (formData.get("apiKeys") || "")
    .split(/\n+/)
    .map((key) => key.trim())
    .filter(Boolean);

  if (!name || !apiUrl) return;

  state.channels.push({
    id: crypto.randomUUID(),
    name,
    apiUrl,
    apiKeys
  });

  queueSave();
  channelForm.reset();
  renderChannels();
  updateChannelSelects();
});

fetchModelsBtn.addEventListener("click", async () => {
  const id = modelChannelSelect.value;
  const channel = state.channels.find((item) => item.id === id);
  if (!channel) return;
  modelList.innerHTML = "";
  const loading = document.createElement("span");
  loading.className = "muted";
  loading.textContent = "加载中...";
  modelList.appendChild(loading);
  try {
    const apiKey = channel.apiKeys[0] || "";
    const apiUrl = String(channel.apiUrl || "").trim();
    if (!apiUrl) {
      throw new Error("渠道 API URL 为空");
    }
    const resp = await fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiUrl, apiKey })
    });
    const data = await resp.json();
    if (!resp.ok) {
      const detail = data?.detail ? `（${data.detail}）` : "";
      throw new Error(`${data?.error || "模型拉取失败"}${detail}`);
    }
    const models = Array.isArray(data.data)
      ? data.data.map((item) => item?.id).filter(Boolean)
      : Array.isArray(data.models)
        ? data.models.map((item) => (typeof item === "string" ? item : item?.id)).filter(Boolean)
        : [];
    modelList.innerHTML = "";
    if (models.length === 0) {
      const empty = document.createElement("span");
      empty.className = "muted";
      empty.textContent = "未返回模型（请检查渠道地址/Key 或服务端兼容性）";
      modelList.appendChild(empty);
      return;
    }
    models.forEach((model) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = model;
      modelList.appendChild(chip);
    });
  } catch (err) {
    modelList.innerHTML = "";
    const error = document.createElement("span");
    error.className = "muted";
    error.textContent = String(err.message || "模型拉取失败");
    modelList.appendChild(error);
  }
});

const scheduleForm = document.getElementById("schedule-form");
const scheduleList = document.getElementById("schedule-list");
const scheduleGroupSelect = document.getElementById("schedule-group-select");
const addScheduleStepBtn = document.getElementById("add-schedule-step");
const scheduleGroupList = document.getElementById("schedule-group-list");
const deleteGroupBtn = document.getElementById("delete-group");
const duplicateGroupBtn = document.getElementById("duplicate-group");
const quickHealthBtn = document.getElementById("quick-health");
const healthResults = document.getElementById("health-results");
const saveScheduleSettingsBtn = document.getElementById("save-schedule-settings");
const scheduleNameInput = document.getElementById("schedule-name");
const systemInjectSelect = document.getElementById("system-inject");
const userInjectSelect = document.getElementById("user-inject");
const systemInjectTextInput = document.getElementById("system-inject-text");
const userInjectTextInput = document.getElementById("user-inject-text");
const editInjectBtn = document.getElementById("edit-inject");
const scheduleMoreBtn = document.getElementById("schedule-more");
const scheduleMoreModal = document.getElementById("schedule-more-modal");
const scheduleMoreCloseBtn = document.getElementById("schedule-more-close");
const scheduleMoreCancelBtn = document.getElementById("schedule-more-cancel");
const scheduleMoreSaveBtn = document.getElementById("schedule-more-save");
const scheduleConcurrencyInput = document.getElementById("schedule-concurrency");
const scheduleTimeoutInput = document.getElementById("schedule-timeout");
const toggleGroupListBtn = document.getElementById("toggle-group-list");
const minCharsInput = document.getElementById("min-chars");
const maxCharsInput = document.getElementById("max-chars");
const autoRetryInput = document.getElementById("auto-retry");
const saveRulesBtn = document.getElementById("save-global-rules");
const promptList = document.getElementById("prompt-list");
const promptTabs = document.querySelectorAll("#prompts .segmented .seg-item");
const promptListTabs = document.querySelectorAll("#prompts .segmented.small .seg-item");
const promptNameInput = document.getElementById("prompt-name");
const promptContentInput = document.getElementById("prompt-content");
const savePromptBtn = document.getElementById("save-prompt");
const clearPromptBtn = document.getElementById("clear-prompt");
const promptModeLabel = document.getElementById("prompt-mode-label");
const promptSaveStatus = document.getElementById("prompt-save-status");
const labelSystemPresetSelect = document.getElementById("label-system-preset");
const labelUserPresetSelect = document.getElementById("label-user-preset");
const applySystemPresetBtn = document.getElementById("apply-system-preset");
const applyUserPresetBtn = document.getElementById("apply-user-preset");
const labelSystemText = document.getElementById("label-system-text");
const labelUserText = document.getElementById("label-user-text");
const labelGroupSelect = document.getElementById("label-group");
const labelScheduleSelect = document.getElementById("label-schedule");
const labelStartBtn = document.getElementById("label-start");
const labelStopBtn = document.getElementById("label-stop");
const labelStatus = document.getElementById("label-status");
const labelMonitor = document.getElementById("label-monitor");
const retryGroupSelect = document.getElementById("retry-group");
const retryScheduleSelect = document.getElementById("retry-schedule");
const retryMinCharsInput = document.getElementById("retry-min-chars");
const retrySystemPresetSelect = document.getElementById("retry-system-preset");
const retryUserPresetSelect = document.getElementById("retry-user-preset");
const applyRetrySystemPresetBtn = document.getElementById("apply-retry-system-preset");
const applyRetryUserPresetBtn = document.getElementById("apply-retry-user-preset");
const retrySystemText = document.getElementById("retry-system-text");
const retryUserText = document.getElementById("retry-user-text");
const retryStartBtn = document.getElementById("retry-start");
const retryStopBtn = document.getElementById("retry-stop");
const retryStatus = document.getElementById("retry-status");
const retryMonitor = document.getElementById("retry-monitor");
const retryList = document.getElementById("retry-list");
const retryEmpty = document.getElementById("retry-empty");
const clearRetryResultsBtn = document.getElementById("clear-retry-results");
const saveRetryResultsBtn = document.getElementById("save-retry-results");
const batchSaveGroupSelect = document.getElementById("batch-save-group-select");
const batchSaveTabs = document.querySelectorAll("#labeling .segmented.small .seg-item");
const batchSaveGroupPanel = document.getElementById("batch-save-group-panel");
const batchSaveManualPanel = document.getElementById("batch-save-manual-panel");
const batchSaveGroupBtn = document.getElementById("batch-save-group-btn");
const batchSaveManualBtn = document.getElementById("batch-save-manual-btn");
const batchSavePathInput = document.getElementById("batch-save-path");
const previewList = document.getElementById("preview-list");
const clearPreviewResultsBtn = document.getElementById("clear-preview-results");
const previewEmpty = document.getElementById("preview-empty");
const labelLogList = document.getElementById("label-log-list");
const clearLabelLogsBtn = document.getElementById("clear-label-logs");
const labelLogEmpty = document.getElementById("label-log-empty");
const configCenterActions = document.getElementById("config-center-actions");
const configCenterStatus = document.getElementById("config-center-status");
const configImportInput = document.getElementById("config-import-input");
const configOverviewSummary = document.getElementById("config-overview-summary");
const configOverviewList = document.getElementById("config-overview-list");
const configDiagnosticsSummary = document.getElementById("config-diagnostics-summary");
const configDiagnosticsList = document.getElementById("config-diagnostics-list");

const saveStatus = document.getElementById("save-status");

let promptMode = "system";
let editingPromptId = null;
let healthResultsData = [];
let healthOnlyFail = false;
const previewSelectedIds = new Set();
const retrySelectedIds = new Set();
let configOverviewData = null;
let configDiagnosticsData = null;

function scheduleGroupLabel(group) {
  return group?.name ? group.name : "未命名调度组";
}

function renderScheduleGroupSelect() {
  if (!scheduleGroupSelect) return;
  const prevValue = scheduleGroupSelect.value;
  scheduleGroupSelect.innerHTML = "";
  if (state.scheduleGroups.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无调度组";
    scheduleGroupSelect.appendChild(option);
    return;
  }
  state.scheduleGroups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = scheduleGroupLabel(group);
    option.selected = group.id === prevValue;
    scheduleGroupSelect.appendChild(option);
  });
  if (!scheduleGroupSelect.value) {
    scheduleGroupSelect.value = state.scheduleGroups[0].id;
  }
}

function syncScheduleForm(group) {
  if (!group) {
    scheduleNameInput.value = "";
    systemInjectSelect.value = "front";
    userInjectSelect.value = "front";
    systemInjectTextInput.value = "";
    userInjectTextInput.value = "";
    return;
  }
  scheduleNameInput.value = group.name || "";
  systemInjectSelect.value = group.systemInject || "front";
  userInjectSelect.value = group.userInject || "front";
  systemInjectTextInput.value = group.systemInjectText || group.injectText || "";
  userInjectTextInput.value = group.userInjectText || "";
}

function openScheduleMoreModal(group) {
  if (!group || !scheduleMoreModal) return;
  scheduleConcurrencyInput.value = group.concurrency || 1;
  scheduleTimeoutInput.value = group.timeoutSec || 60;
  scheduleMoreModal.classList.remove("is-hidden");
}

function closeScheduleMoreModal() {
  if (!scheduleMoreModal) return;
  scheduleMoreModal.classList.add("is-hidden");
}

function applyInjectToMessages(group, baseMessages) {
  const messages = Array.isArray(baseMessages) ? [...baseMessages] : [];
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
  return messages;
}

function syncGlobalRules() {
  minCharsInput.value = state.globalRules.minChars ?? 200;
  maxCharsInput.value = state.globalRules.maxChars ?? 200;
  autoRetryInput.checked = state.globalRules.autoRetry !== false;
}

function renderScheduleGroupList() {
  if (!scheduleGroupList) return;
  scheduleGroupList.innerHTML = "";
  if (state.scheduleGroups.length === 0) {
    scheduleGroupList.innerHTML = "<p class=\"muted\">暂无调度组。</p>";
    return;
  }
  const activeId = scheduleGroupSelect.value;
  state.scheduleGroups.forEach((group) => {
    const item = document.createElement("div");
    item.className = "group-item";
    if (group.id === activeId) item.classList.add("active");

    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = scheduleGroupLabel(group);

    const muted = document.createElement("div");
    muted.className = "muted";
    const systemInjectText = group.systemInject === "front" ? "系统前置" : "系统后置";
    const userInjectText = group.userInject === "front" ? "用户前置" : "用户后置";
    muted.textContent = `步骤 ${group.steps.length} · 注入 ${systemInjectText} / ${userInjectText}`;

    info.append(title, muted);

    const actions = document.createElement("div");
    actions.className = "group-actions";

    const moveUpBtn = document.createElement("button");
    moveUpBtn.className = "ghost";
    moveUpBtn.dataset.action = "move-up";
    moveUpBtn.dataset.id = group.id;
    moveUpBtn.textContent = "上移";

    const moveDownBtn = document.createElement("button");
    moveDownBtn.className = "ghost";
    moveDownBtn.dataset.action = "move-down";
    moveDownBtn.dataset.id = group.id;
    moveDownBtn.textContent = "下移";

    const selectBtn = document.createElement("button");
    selectBtn.className = "ghost";
    selectBtn.dataset.action = "select-group";
    selectBtn.dataset.id = group.id;
    selectBtn.textContent = "选择";

    actions.append(moveUpBtn, moveDownBtn, selectBtn);
    item.append(info, actions);
    scheduleGroupList.appendChild(item);
  });
}

function renderScheduleSteps() {
  scheduleList.innerHTML = "";
  healthResultsData = [];
  healthOnlyFail = false;
  renderHealthResults();
  const groupId = scheduleGroupSelect.value;
  const group = state.scheduleGroups.find((item) => item.id === groupId);
  if (!group || group.steps.length === 0) {
    scheduleList.innerHTML = "<p class=\"muted\">暂无调度步骤。</p>";
    return;
  }
  group.steps.forEach((step, index) => {
    const card = document.createElement("div");
    card.className = "schedule-step";

    const channelLabel = document.createElement("label");
    channelLabel.append("渠道");
    const channelSelect = document.createElement("select");
    channelSelect.dataset.field = "channelId";
    channelSelect.dataset.index = String(index);
    state.channels.forEach((channel) => {
      const option = document.createElement("option");
      option.value = channel.id;
      option.textContent = channel.name || "";
      option.selected = channel.id === step.channelId;
      channelSelect.appendChild(option);
    });
    channelLabel.appendChild(channelSelect);

    const modelLabel = document.createElement("label");
    modelLabel.append("模型");
    const modelInput = document.createElement("input");
    modelInput.type = "text";
    modelInput.dataset.field = "model";
    modelInput.dataset.index = String(index);
    modelInput.value = step.model || "";
    modelInput.placeholder = "例如: gemini3.0flash";
    modelLabel.appendChild(modelInput);

    const retriesLabel = document.createElement("label");
    retriesLabel.append("重试次数");
    const retriesInput = document.createElement("input");
    retriesInput.type = "number";
    retriesInput.min = "0";
    retriesInput.dataset.field = "retries";
    retriesInput.dataset.index = String(index);
    retriesInput.value = String(step.retries);
    retriesLabel.appendChild(retriesInput);

    const intervalLabel = document.createElement("label");
    intervalLabel.append("重试间隔(s)");
    const intervalInput = document.createElement("input");
    intervalInput.type = "number";
    intervalInput.min = "0";
    intervalInput.dataset.field = "interval";
    intervalInput.dataset.index = String(index);
    intervalInput.value = String(step.interval);
    intervalLabel.appendChild(intervalInput);

    const concurrencyLabel = document.createElement("label");
    concurrencyLabel.append("并发数");
    const concurrencyInput = document.createElement("input");
    concurrencyInput.type = "number";
    concurrencyInput.min = "1";
    concurrencyInput.dataset.field = "concurrency";
    concurrencyInput.dataset.index = String(index);
    concurrencyInput.value = String(step.concurrency || 1);
    concurrencyLabel.appendChild(concurrencyInput);

    const timeoutLabel = document.createElement("label");
    timeoutLabel.append("超时(s)");
    const timeoutInput = document.createElement("input");
    timeoutInput.type = "number";
    timeoutInput.min = "1";
    timeoutInput.dataset.field = "timeoutSec";
    timeoutInput.dataset.index = String(index);
    timeoutInput.value = String(step.timeoutSec || 60);
    timeoutLabel.appendChild(timeoutInput);

    const enabledLabel = document.createElement("label");
    enabledLabel.append("启用");
    const enabledSelect = document.createElement("select");
    enabledSelect.dataset.field = "enabled";
    enabledSelect.dataset.index = String(index);

    const enabledOption = document.createElement("option");
    enabledOption.value = "true";
    enabledOption.selected = step.enabled !== false;
    enabledOption.textContent = "开启";

    const disabledOption = document.createElement("option");
    disabledOption.value = "false";
    disabledOption.selected = step.enabled === false;
    disabledOption.textContent = "停用";

    enabledSelect.append(enabledOption, disabledOption);
    enabledLabel.appendChild(enabledSelect);

    const stepActions = document.createElement("div");
    stepActions.className = "group-actions";

    const moveUpBtn = document.createElement("button");
    moveUpBtn.className = "ghost";
    moveUpBtn.dataset.action = "move-up";
    moveUpBtn.dataset.index = String(index);
    moveUpBtn.textContent = "上移";

    const moveDownBtn = document.createElement("button");
    moveDownBtn.className = "ghost";
    moveDownBtn.dataset.action = "move-down";
    moveDownBtn.dataset.index = String(index);
    moveDownBtn.textContent = "下移";

    const duplicateBtn = document.createElement("button");
    duplicateBtn.className = "ghost";
    duplicateBtn.dataset.action = "duplicate";
    duplicateBtn.dataset.index = String(index);
    duplicateBtn.textContent = "复制";

    const removeBtn = document.createElement("button");
    removeBtn.className = "ghost danger";
    removeBtn.dataset.action = "remove-step";
    removeBtn.dataset.index = String(index);
    removeBtn.textContent = "删除";

    stepActions.append(moveUpBtn, moveDownBtn, duplicateBtn, removeBtn);

    card.append(
      channelLabel,
      modelLabel,
      retriesLabel,
      intervalLabel,
      concurrencyLabel,
      timeoutLabel,
      enabledLabel,
      stepActions
    );

    scheduleList.appendChild(card);
  });
}

function renderHealthResults() {
  if (!healthResults) return;
  healthResults.innerHTML = "";
  if (!Array.isArray(healthResultsData) || healthResultsData.length === 0) return;

  const total = healthResultsData.length;
  const successCount = healthResultsData.filter((item) => item.status === "ok").length;
  const failCount = healthResultsData.filter((item) => item.status === "fail").length;
  const missingCount = healthResultsData.filter((item) => item.status === "missing").length;

  const summary = document.createElement("div");
  summary.className = "health-item";
  summary.textContent = `总计 ${total} · 成功 ${successCount} · 失败 ${failCount} · 缺配置 ${missingCount}`;

  const filterLabel = document.createElement("label");
  filterLabel.className = "row";
  const filterInput = document.createElement("input");
  filterInput.type = "checkbox";
  filterInput.checked = healthOnlyFail;
  filterInput.addEventListener("change", () => {
    healthOnlyFail = filterInput.checked;
    renderHealthResults();
  });
  const filterText = document.createElement("span");
  filterText.textContent = "仅看失败";
  filterLabel.append(filterInput, filterText);

  healthResults.append(summary, filterLabel);

  healthResultsData
    .filter((item) => !healthOnlyFail || item.status === "fail" || item.status === "missing")
    .forEach((item) => {
      const row = document.createElement("div");
      row.className = "health-item";
      if (item.status === "ok") row.classList.add("ok");
      if (item.status === "fail" || item.status === "missing") row.classList.add("fail");
      row.textContent = item.text;
      healthResults.appendChild(row);
    });
}

scheduleGroupSelect.addEventListener("change", () => {
  const group = state.scheduleGroups.find((item) => item.id === scheduleGroupSelect.value);
  syncScheduleForm(group);
  renderScheduleSteps();
  renderScheduleGroupList();
});

editInjectBtn.addEventListener("click", () => {
  const group = state.scheduleGroups.find((item) => item.id === scheduleGroupSelect.value);
  if (!group) return;
  syncScheduleForm(group);
  scheduleNameInput.scrollIntoView({ behavior: "smooth", block: "center" });
  scheduleNameInput.focus();
});

scheduleMoreBtn.addEventListener("click", () => {
  const group = state.scheduleGroups.find((item) => item.id === scheduleGroupSelect.value);
  if (!group) return;
  openScheduleMoreModal(group);
});

scheduleMoreCloseBtn.addEventListener("click", closeScheduleMoreModal);
scheduleMoreCancelBtn.addEventListener("click", closeScheduleMoreModal);

scheduleMoreSaveBtn.addEventListener("click", async () => {
  const group = state.scheduleGroups.find((item) => item.id === scheduleGroupSelect.value);
  if (!group) return;
  const concurrency = Number(scheduleConcurrencyInput.value || 1);
  const timeoutSec = Number(scheduleTimeoutInput.value || 60);
  group.concurrency = Math.max(1, concurrency);
  group.timeoutSec = Math.max(1, timeoutSec);
  await saveStateNow();
  closeScheduleMoreModal();
});

scheduleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = scheduleNameInput.value.trim();
  const systemInject = systemInjectSelect.value;
  const userInject = userInjectSelect.value;
  const systemInjectText = systemInjectTextInput.value.trim();
  const userInjectText = userInjectTextInput.value.trim();
  if (!name) return;
  state.scheduleGroups.push({
    id: crypto.randomUUID(),
    name,
    systemInject,
    userInject,
    systemInjectText,
    userInjectText,
    steps: []
  });
  queueSave();
  scheduleForm.reset();
  renderScheduleGroupSelect();
  scheduleGroupSelect.value = state.scheduleGroups[state.scheduleGroups.length - 1].id;
  syncScheduleForm(state.scheduleGroups[state.scheduleGroups.length - 1]);
  renderScheduleSteps();
  renderScheduleGroupList();
  updateChannelSelects();
});

saveScheduleSettingsBtn.addEventListener("click", () => {
  const id = scheduleGroupSelect.value;
  const group = state.scheduleGroups.find((item) => item.id === id);
  if (!group) return;
  const name = scheduleNameInput.value.trim();
  if (!name) return;
  group.name = name;
  group.systemInject = systemInjectSelect.value;
  group.userInject = userInjectSelect.value;
  group.systemInjectText = systemInjectTextInput.value.trim();
  group.userInjectText = userInjectTextInput.value.trim();
  queueSave();
  renderScheduleGroupSelect();
  scheduleGroupSelect.value = group.id;
  renderScheduleGroupList();
  updateChannelSelects();
});

saveRulesBtn.addEventListener("click", () => {
  state.globalRules = {
    minChars: Number(minCharsInput.value || 0),
    maxChars: Number(maxCharsInput.value || 0),
    autoRetry: autoRetryInput.checked
  };
  queueSave();
});

addScheduleStepBtn.addEventListener("click", () => {
  const groupId = scheduleGroupSelect.value;
  const group = state.scheduleGroups.find((item) => item.id === groupId);
  if (!group) return;
  const channel = state.channels[0];
  const step = {
    channelId: channel ? channel.id : "",
    model: "",
    retries: 3,
    interval: 5,
    concurrency: 1,
    timeoutSec: 60,
    enabled: true
  };
  group.steps.push(step);
  queueSave();
  renderScheduleSteps();
});

function updateScheduleStepField(target) {
  if (!target?.dataset) return;
  const index = Number(target.dataset.index);
  const field = target.dataset.field;
  if (!Number.isFinite(index) || !field) return;
  const groupId = scheduleGroupSelect.value;
  const group = state.scheduleGroups.find((item) => item.id === groupId);
  if (!group) return;
  const step = group.steps[index];
  if (!step) return;

  if (field === "retries") {
    const value = Number(target.value || 0);
    step.retries = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    target.value = String(step.retries);
  } else if (field === "interval") {
    const value = Number(target.value || 0);
    step.interval = Number.isFinite(value) ? Math.max(0, value) : 0;
    target.value = String(step.interval);
  } else if (field === "concurrency" || field === "timeoutSec") {
    const value = Number(target.value || 1);
    step[field] = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
    target.value = String(step[field]);
  } else if (field === "enabled") {
    step.enabled = target.value === "true";
  } else {
    step[field] = target.value;
  }
  queueSave();
}

scheduleList.addEventListener("input", (event) => {
  updateScheduleStepField(event.target);
});

scheduleList.addEventListener("change", (event) => {
  updateScheduleStepField(event.target);
});

scheduleList.addEventListener("click", (event) => {
  const target = event.target;
  const actionBtn = target.closest("button[data-action]");
  if (!actionBtn) return;
  const action = actionBtn.dataset.action;
  const index = Number(actionBtn.dataset.index);
  const groupId = scheduleGroupSelect.value;
  const group = state.scheduleGroups.find((item) => item.id === groupId);
  if (!group || !Number.isFinite(index) || index < 0 || index >= group.steps.length) return;

  if (action === "remove-step") {
    group.steps.splice(index, 1);
  }
  if (action === "move-up" && index > 0) {
    const [step] = group.steps.splice(index, 1);
    group.steps.splice(index - 1, 0, step);
  }
  if (action === "move-down" && index < group.steps.length - 1) {
    const [step] = group.steps.splice(index, 1);
    group.steps.splice(index + 1, 0, step);
  }
  if (action === "duplicate") {
    const source = group.steps[index];
    group.steps.splice(index + 1, 0, { ...source });
  }

  queueSave();
  renderScheduleSteps();
});

scheduleGroupList.addEventListener("click", (event) => {
  const target = event.target;
  const id = target.dataset.id;
  if (!id) return;
  const index = state.scheduleGroups.findIndex((item) => item.id === id);
  if (index === -1) return;
  if (target.dataset.action === "select-group") {
    scheduleGroupSelect.value = id;
    renderScheduleSteps();
    renderScheduleGroupList();
    return;
  }
  if (target.dataset.action === "move-up" && index > 0) {
    const [group] = state.scheduleGroups.splice(index, 1);
    state.scheduleGroups.splice(index - 1, 0, group);
  }
  if (target.dataset.action === "move-down" && index < state.scheduleGroups.length - 1) {
    const [group] = state.scheduleGroups.splice(index, 1);
    state.scheduleGroups.splice(index + 1, 0, group);
  }
  queueSave();
  renderScheduleGroupSelect();
  scheduleGroupSelect.value = id;
  renderScheduleSteps();
  renderScheduleGroupList();
  updateChannelSelects();
});

toggleGroupListBtn.addEventListener("click", () => {
  scheduleGroupList.classList.toggle("is-collapsed");
  toggleGroupListBtn.textContent = scheduleGroupList.classList.contains("is-collapsed")
    ? "展开列表"
    : "折叠列表";
});

deleteGroupBtn.addEventListener("click", () => {
  const id = scheduleGroupSelect.value;
  if (!id) return;
  state.scheduleGroups = state.scheduleGroups.filter((group) => group.id !== id);
  queueSave();
  renderScheduleGroupSelect();
  if (state.scheduleGroups.length > 0) {
    scheduleGroupSelect.value = state.scheduleGroups[0].id;
  }
  syncScheduleForm(state.scheduleGroups.find((item) => item.id === scheduleGroupSelect.value));
  renderScheduleSteps();
  renderScheduleGroupList();
  updateChannelSelects();
});

duplicateGroupBtn.addEventListener("click", () => {
  const id = scheduleGroupSelect.value;
  const group = state.scheduleGroups.find((item) => item.id === id);
  if (!group) return;
  const clone = {
    ...group,
    id: crypto.randomUUID(),
    name: `${group.name}-copy`,
    steps: group.steps.map((step) => ({ ...step }))
  };
  state.scheduleGroups.push(clone);
  queueSave();
  renderScheduleGroupSelect();
  scheduleGroupSelect.value = clone.id;
  syncScheduleForm(clone);
  renderScheduleSteps();
  renderScheduleGroupList();
  updateChannelSelects();
});

quickHealthBtn.addEventListener("click", async () => {
  const id = scheduleGroupSelect.value;
  const group = state.scheduleGroups.find((item) => item.id === id);
  if (!group) return;
  const enabledSteps = (group.steps || []).filter((step) => step.enabled !== false);
  healthResultsData = [];
  healthOnlyFail = false;
  renderHealthResults();
  if (enabledSteps.length === 0) {
    healthResultsData.push({
      status: "missing",
      text: "缺少可用步骤：请至少启用一个调度步骤。",
      channelName: "无渠道",
      modelName: "无模型"
    });
    renderHealthResults();
    return;
  }
  for (const step of enabledSteps) {
    const channel = state.channels.find((item) => item.id === step.channelId);
    const itemText = !channel || !step.model
      ? `缺少配置: ${channel ? channel.name : "无渠道"} / ${step.model || "无模型"}`
      : `测活中: ${channel.name} / ${step.model}`;
    const current = {
      status: !channel || !step.model ? "missing" : "checking",
      text: itemText,
      channelName: channel?.name || "无渠道",
      modelName: step.model || "无模型"
    };
    healthResultsData.push(current);
    renderHealthResults();
    if (current.status === "missing") continue;
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiUrl: channel.apiUrl,
          apiKey: channel.apiKeys[0] || "",
          payload: {
            model: step.model,
            messages: applyInjectToMessages(group, [
              { role: "system", content: "health check" },
              { role: "user", content: "ping" }
            ]),
            max_tokens: 8
          }
        })
      });
      if (!resp.ok) throw new Error("请求失败");
      current.status = "ok";
      current.text = `可用: ${current.channelName} / ${current.modelName}`;
    } catch {
      current.status = "fail";
      current.text = `失败: ${current.channelName} / ${current.modelName}`;
    }
    renderHealthResults();
  }
});

const groupForm = document.getElementById("group-form");
const groupList = document.getElementById("group-list");
let editingGroupId = null;

function renderGroups() {
  groupList.innerHTML = "";
  if (state.groups.length === 0) {
    groupList.innerHTML = "<p class=\"muted\">暂无文件分组。</p>";
    return;
  }
  state.groups.forEach((group) => {
    const item = document.createElement("div");
    item.className = "group-item";
    item.dataset.id = group.id;
    if (editingGroupId === group.id) {
      item.classList.add("active");

      const stack = document.createElement("div");
      stack.className = "stack";

      const pathInput = document.createElement("input");
      pathInput.type = "text";
      pathInput.className = "group-edit-path";
      pathInput.value = group.path || "";

      const noteInput = document.createElement("input");
      noteInput.type = "text";
      noteInput.className = "group-edit-note";
      noteInput.value = group.note || "";
      noteInput.placeholder = "备注";

      stack.append(pathInput, noteInput);

      const actions = document.createElement("div");
      actions.className = "group-actions";
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "ghost danger";
      deleteBtn.dataset.action = "delete";
      deleteBtn.dataset.id = group.id;
      deleteBtn.textContent = "删除";
      actions.append(deleteBtn);

      item.append(stack, actions);
    } else {
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = group.path || "";
      const note = document.createElement("div");
      note.className = "muted";
      note.textContent = group.note || "无备注";
      info.append(title, note);

      const actions = document.createElement("div");
      actions.className = "group-actions";
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "ghost danger";
      deleteBtn.dataset.action = "delete";
      deleteBtn.dataset.id = group.id;
      deleteBtn.textContent = "删除";
      actions.append(deleteBtn);

      item.append(info, actions);
    }
    groupList.appendChild(item);
  });
}

function saveGroupEdit() {
  if (!editingGroupId) return;
  const item = groupList.querySelector(`.group-item[data-id="${editingGroupId}"]`);
  if (!item) return;
  const pathInput = item.querySelector(".group-edit-path");
  const noteInput = item.querySelector(".group-edit-note");
  if (!pathInput || !noteInput) return;
  const nextPath = pathInput.value.trim();
  const nextNote = noteInput.value.trim();
  if (!nextPath) {
    alert("路径不能为空。");
    return;
  }
  const group = state.groups.find((entry) => entry.id === editingGroupId);
  if (!group) return;
  group.path = nextPath;
  group.note = nextNote;
  editingGroupId = null;
  queueSave();
  renderGroups();
  updateGroupSelects();
}

groupList.addEventListener("click", (event) => {
  const target = event.target;
  if (!target.matches("button[data-action]")) return;
  const id = target.dataset.id;
  const action = target.dataset.action;
  const group = state.groups.find((item) => item.id === id);
  if (!group) return;

  if (action === "delete") {
    if (!confirm(`确认删除分组：${group.path} ？`)) return;
    state.groups = state.groups.filter((item) => item.id !== id);
    if (editingGroupId === id) editingGroupId = null;
    queueSave();
    renderGroups();
    updateGroupSelects();
    return;
  }
});

groupList.addEventListener("dblclick", (event) => {
  const item = event.target.closest(".group-item");
  if (!item) return;
  const id = item.dataset.id;
  if (!id) return;
  if (editingGroupId === id) {
    saveGroupEdit();
    return;
  }
  editingGroupId = id;
  renderGroups();
  const pathInput = item.querySelector(".group-edit-path");
  if (pathInput) {
    pathInput.focus();
    pathInput.select();
  }
});

groupList.addEventListener("keydown", (event) => {
  if (!editingGroupId) return;
  if (event.key === "Enter") {
    event.preventDefault();
    saveGroupEdit();
  }
  if (event.key === "Escape") {
    editingGroupId = null;
    renderGroups();
  }
});

groupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(groupForm);
  const path = formData.get("path").trim();
  const note = formData.get("note").trim();
  if (!path) return;
  state.groups.push({ id: crypto.randomUUID(), path, note });
  queueSave();
  groupForm.reset();
  renderGroups();
  updateGroupSelects();
});

function updateChannelSelects() {
  const scheduleSelects = [
    document.getElementById("label-schedule"),
    document.getElementById("retry-schedule")
  ];

  scheduleSelects.forEach((select) => {
    if (!select) return;
    const prevValue = select.value;
    select.innerHTML = "";
    if (state.scheduleGroups.length === 0) {
      const option = document.createElement("option");
      option.textContent = "暂无调度";
      option.value = "";
      select.appendChild(option);
      return;
    }

    state.scheduleGroups.forEach((group) => {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = scheduleGroupLabel(group);
      option.selected = group.id === prevValue;
      select.appendChild(option);
    });

    if (!select.value) {
      select.value = state.scheduleGroups[0].id;
    }
  });
}

function updateGroupSelects() {
  const selects = [
    document.getElementById("label-group"),
    document.getElementById("tag-group"),
    document.getElementById("retry-group")
  ];
  const fillGroupOptions = (select) => {
    const prevValue = select.value;
    select.innerHTML = "";
    if (state.groups.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "暂无分组";
      select.appendChild(option);
      return;
    }
    state.groups.forEach((group) => {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.path || "";
      option.selected = group.id === prevValue;
      select.appendChild(option);
    });
    if (!select.value) {
      select.value = state.groups[0].id;
    }
  };

  selects.forEach((select) => {
    if (!select) return;
    fillGroupOptions(select);
  });

  if (batchSaveGroupSelect) {
    fillGroupOptions(batchSaveGroupSelect);
  }

  if (tagGroupSelect && tagGroupSelect.value) {
    loadTagResults();
  } else {
    tagResults = [];
    tagSelectedIndex = -1;
    tagEditingTags = [];
    renderTagPreviewList();
    renderTags();
  }
}

const tagGroupSelect = document.getElementById("tag-group");
const tagEditor = document.getElementById("tag-editor");
const tagInput = document.getElementById("tag-input");
const addTagBtn = document.getElementById("add-tag");
const saveTagBtn = document.getElementById("save-tag");
const undoTagBtn = document.getElementById("undo-tag");
const tagEmpty = document.getElementById("tag-empty");
const tagPreviewList = document.getElementById("tag-preview-list");
const tagPreviewEmpty = document.getElementById("tag-preview-empty");
const tagReloadBtn = document.getElementById("tag-reload");
const tagStatus = document.getElementById("tag-status");
const tagDedupeMode = document.getElementById("tag-dedupe-mode");
const tagReplaceFromInput = document.getElementById("tag-replace-from");
const tagReplaceToInput = document.getElementById("tag-replace-to");
const replaceTagTextBtn = document.getElementById("replace-tag-text");
const replaceTagTextAllBtn = document.getElementById("replace-tag-text-all");

let tagResults = [];
let tagSelectedIndex = -1;
let tagEditingTags = [];
let tagHistory = [];
let dragIndex = null;
let currentTagGroupId = "";
let tagLoadToken = 0;

function updateUndoTagButton() {
  if (!undoTagBtn) return;
  undoTagBtn.disabled = tagHistory.length === 0;
}

function flashTagStatus(message, duration = 1500) {
  if (!tagStatus) return;
  tagStatus.textContent = message;
  if (duration > 0) {
    setTimeout(() => {
      if (tagStatus) tagStatus.textContent = "";
    }, duration);
  }
}

function clearTagDropTarget() {
  if (!tagEditor) return;
  const highlighted = tagEditor.querySelectorAll(".tag-item.is-drop-target");
  highlighted.forEach((item) => item.classList.remove("is-drop-target"));
}

function hasUnsavedTagChanges() {
  if (tagSelectedIndex < 0 || tagSelectedIndex >= tagResults.length) return false;
  const current = serializeTags(tagEditingTags);
  const saved = serializeTags(parseTags(tagResults[tagSelectedIndex]?.text || ""));
  return current !== saved;
}

function confirmTagSwitchIfNeeded() {
  if (!hasUnsavedTagChanges()) return true;
  return confirm("当前标签有未保存修改，确认切换吗？");
}

function parseTags(text) {
  return String(text || "")
    .split(/[,，\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveGroupDir(group) {
  if (!group || typeof group !== "object") return "";
  const primary = String(group.path || "").trim();
  if (primary.startsWith("/") || /^[A-Za-z]:[\\/]/.test(primary)) return primary;
  const note = String(group.note || "").trim();
  if (note.startsWith("/") || /^[A-Za-z]:[\\/]/.test(note)) return note;
  return primary || note;
}

function serializeTags(tags) {
  return (tags || []).map((item) => item.trim()).filter(Boolean).join(", ");
}

function renderTags() {
  if (!tagEditor) return;
  tagEditor.innerHTML = "";
  if (!tagEditingTags || tagEditingTags.length === 0) {
    if (tagEmpty) tagEmpty.style.display = "block";
    updateUndoTagButton();
    return;
  }
  if (tagEmpty) tagEmpty.style.display = "none";
  tagEditingTags.forEach((text, index) => {
    const item = document.createElement("div");
    item.className = "tag-item";
    item.dataset.index = String(index);
    item.draggable = true;

    const tagText = document.createElement("span");
    tagText.className = "tag tag-text";
    tagText.textContent = text;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "tag-delete";
    deleteBtn.type = "button";
    deleteBtn.dataset.index = String(index);
    deleteBtn.textContent = "删除";

    item.append(tagText, deleteBtn);
    tagEditor.appendChild(item);
  });
  updateUndoTagButton();
}

function renderTagPreviewList() {
  if (!tagPreviewList) return;
  if (tagResults.length === 0) {
    tagPreviewList.innerHTML = "";
    if (tagPreviewEmpty) tagPreviewEmpty.style.display = "block";
    return;
  }
  if (tagPreviewEmpty) tagPreviewEmpty.style.display = "none";
  tagPreviewList.innerHTML = "";
  tagResults.forEach((item, index) => {
    const listCard = document.createElement("div");
    listCard.className = "result-card";
    if (index === tagSelectedIndex) listCard.classList.add("is-selected");
    listCard.dataset.index = String(index);

    const img = document.createElement("img");
    img.className = "result-thumb";
    img.src = item.imageUrl || "";
    img.alt = "tag 预览图像";

    const body = document.createElement("div");
    body.className = "result-body";

    const meta = document.createElement("div");
    meta.className = "prompt-meta";
    const title = document.createElement("strong");
    title.textContent = item.name || "未命名";
    meta.append(title);

    const content = document.createElement("div");
    content.className = "result-text";
    content.textContent = item.text || "";

    body.append(meta, content);
    listCard.append(img, body);
    tagPreviewList.appendChild(listCard);
  });
}

function selectTagResult(index) {
  if (!Number.isInteger(index) || index < 0 || index >= tagResults.length) return;
  tagSelectedIndex = index;
  const item = tagResults[index];
  tagEditingTags = parseTags(item.text);
  tagHistory = [];
  renderTags();
  renderTagPreviewList();
}

async function loadTagResults() {
  if (!tagGroupSelect) return;
  const groupId = tagGroupSelect.value;
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) {
    tagResults = [];
    tagSelectedIndex = -1;
    tagEditingTags = [];
    tagHistory = [];
    renderTagPreviewList();
    renderTags();
    currentTagGroupId = "";
    if (tagStatus) tagStatus.textContent = "请选择有效分组";
    return;
  }
  const currentToken = ++tagLoadToken;
  if (tagStatus) tagStatus.textContent = "加载中...";
  try {
    const dirPath = resolveGroupDir(group);
    const resp = await fetch("/api/tag-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: dirPath || group.path, note: group.note || "" })
    });
    if (currentToken !== tagLoadToken) return;
    const data = await resp.json();
    if (!resp.ok) {
      const detail = data.detail ? `（${data.detail}）` : "";
      throw new Error(`${data.error || "读取 tag 失败"}${detail}`);
    }
    tagResults = data.results || [];
    tagSelectedIndex = tagResults.length > 0 ? 0 : -1;
    tagEditingTags = tagSelectedIndex >= 0 ? parseTags(tagResults[0].text) : [];
    tagHistory = [];
    currentTagGroupId = groupId;
    renderTagPreviewList();
    renderTags();
    if (tagStatus) {
      tagStatus.textContent = tagResults.length > 0 ? `已加载 ${tagResults.length} 项` : "未找到图片文件";
    }
  } catch (err) {
    if (currentToken !== tagLoadToken) return;
    tagResults = [];
    tagSelectedIndex = -1;
    tagEditingTags = [];
    tagHistory = [];
    renderTagPreviewList();
    renderTags();
    if (tagStatus) tagStatus.textContent = String(err.message || "加载失败");
  }
}

function addTags(raw) {
  const next = raw
    .split(/[,，\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (next.length === 0) return;
  tagHistory.push([...tagEditingTags]);
  const mode = tagDedupeMode?.value || "strict";
  let addedCount = 0;
  let duplicateCount = 0;
  const existingKeys = new Set(
    tagEditingTags.map((item) => (mode === "insensitive" ? item.toLowerCase() : item))
  );
  next.forEach((text) => {
    const key = mode === "insensitive" ? text.toLowerCase() : text;
    if (!existingKeys.has(key)) {
      tagEditingTags.push(text);
      existingKeys.add(key);
      addedCount += 1;
    } else {
      duplicateCount += 1;
    }
  });
  renderTags();
  if (addedCount > 0 || duplicateCount > 0) {
    flashTagStatus(`新增 ${addedCount} 个，重复 ${duplicateCount} 个`);
  }
}

function replaceCurrentTagText() {
  if (tagSelectedIndex < 0 || tagSelectedIndex >= tagResults.length) {
    flashTagStatus("请先选择一个 tag 结果");
    return;
  }
  const from = tagReplaceFromInput?.value ?? "";
  const to = tagReplaceToInput?.value ?? "";
  if (from.length === 0) {
    flashTagStatus("查找内容不能为空");
    return;
  }
  const currentText = serializeTags(tagEditingTags);
  const nextText = currentText.split(from).join(to);
  if (nextText === currentText) {
    flashTagStatus("未找到可替换内容");
    return;
  }
  tagHistory.push([...tagEditingTags]);
  tagEditingTags = parseTags(nextText);
  renderTags();
  flashTagStatus("替换完成");
}

async function replaceAllTagText() {
  if (!Array.isArray(tagResults) || tagResults.length === 0) {
    flashTagStatus("当前没有可替换的 tag 结果");
    return;
  }
  const from = tagReplaceFromInput?.value ?? "";
  const to = tagReplaceToInput?.value ?? "";
  if (from.length === 0) {
    flashTagStatus("查找内容不能为空");
    return;
  }

  const changedItems = tagResults
    .map((item, index) => {
      const currentText = String(item.text || "");
      const nextText = currentText.split(from).join(to);
      return { item, index, currentText, nextText, changed: nextText !== currentText };
    })
    .filter((entry) => entry.changed);

  if (changedItems.length === 0) {
    flashTagStatus("未找到可替换内容");
    return;
  }

  const ok = confirm(`将替换并保存 ${changedItems.length} 个文件，是否继续？`);
  if (!ok) return;

  let success = 0;
  let failed = 0;
  for (const entry of changedItems) {
    try {
      const resp = await fetch("/api/tag-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePath: entry.item.imagePath, text: entry.nextText })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "保存失败");
      entry.item.text = entry.nextText;
      success += 1;
    } catch {
      failed += 1;
    }
  }

  if (tagSelectedIndex >= 0 && tagSelectedIndex < tagResults.length) {
    tagEditingTags = parseTags(tagResults[tagSelectedIndex].text || "");
    tagHistory = [];
  }
  renderTagPreviewList();
  renderTags();
  flashTagStatus(`全局替换完成：成功 ${success}，失败 ${failed}`);
}

async function saveCurrentTags() {
  if (tagSelectedIndex < 0 || tagSelectedIndex >= tagResults.length) {
    alert("请先选择一个 tag 结果。");
    return;
  }
  const item = tagResults[tagSelectedIndex];
  const text = serializeTags(tagEditingTags);
  try {
    const resp = await fetch("/api/tag-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePath: item.imagePath, text })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "保存失败");
    item.text = text;
    renderTagPreviewList();
    if (tagStatus) {
      const savedName = item.name || getImageDisplayName(item.imageUrl);
      flashTagStatus(`已保存：${savedName}`);
    }
  } catch (err) {
    if (tagStatus) tagStatus.textContent = String(err.message || "保存失败");
  }
}

if (tagGroupSelect) {
  tagGroupSelect.addEventListener("change", () => {
    const nextGroupId = tagGroupSelect.value;
    if (nextGroupId === currentTagGroupId) return;
    if (!confirmTagSwitchIfNeeded()) {
      tagGroupSelect.value = currentTagGroupId;
      return;
    }
    loadTagResults();
  });
}

if (tagReloadBtn) {
  tagReloadBtn.addEventListener("click", () => {
    loadTagResults();
  });
}

if (addTagBtn) {
  addTagBtn.addEventListener("click", () => {
    if (!tagInput) return;
    addTags(tagInput.value);
    tagInput.value = "";
  });
}

if (saveTagBtn) {
  saveTagBtn.addEventListener("click", () => {
    saveCurrentTags();
  });
}

if (replaceTagTextBtn) {
  replaceTagTextBtn.addEventListener("click", () => {
    replaceCurrentTagText();
  });
}

if (replaceTagTextAllBtn) {
  replaceTagTextAllBtn.addEventListener("click", () => {
    replaceAllTagText();
  });
}

if (tagInput) {
  tagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTags(tagInput.value);
      tagInput.value = "";
    }
  });
}

if (tagPreviewList) {
  tagPreviewList.addEventListener("click", (event) => {
    const card = event.target.closest(".result-card");
    if (!card) return;
    const index = Number(card.dataset.index);
    if (!Number.isInteger(index)) return;
    if (index === tagSelectedIndex) return;
    if (!confirmTagSwitchIfNeeded()) return;
    selectTagResult(index);
  });
}

if (tagEditor) {
  tagEditor.addEventListener("click", (event) => {
    const target = event.target;
    if (target.matches(".tag-delete")) {
      const index = Number(target.dataset.index);
      if (Number.isInteger(index)) {
        tagHistory.push([...tagEditingTags]);
        tagEditingTags.splice(index, 1);
        renderTags();
      }
    }
  });

  tagEditor.addEventListener("dblclick", (event) => {
    const tagItem = event.target.closest(".tag-item");
    if (!tagItem) return;
    const index = Number(tagItem.dataset.index);
    if (!Number.isInteger(index)) return;
    const textNode = tagItem.querySelector(".tag-text");
    if (!textNode) return;

    const current = tagEditingTags[index] || "";
    const input = document.createElement("input");
    input.type = "text";
    input.value = current;
    input.className = "tag-edit-input";
    textNode.replaceWith(input);
    input.focus();
    input.select();

    const finalize = (mode) => {
      const nextText = input.value.trim();
      if (mode === "cancel") {
        renderTags();
        return;
      }
      tagHistory.push([...tagEditingTags]);
      if (!nextText) {
        tagEditingTags.splice(index, 1);
      } else {
        tagEditingTags[index] = nextText;
      }
      renderTags();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finalize("save");
      if (e.key === "Escape") finalize("cancel");
    });
    input.addEventListener("blur", () => finalize("save"));
  });
}

if (undoTagBtn) {
  undoTagBtn.addEventListener("click", () => {
    if (tagHistory.length === 0) return;
    tagEditingTags = tagHistory.pop();
    renderTags();
  });
}

function moveTag(fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  if (fromIndex < 0 || toIndex < 0) return;
  if (fromIndex >= tagEditingTags.length || toIndex >= tagEditingTags.length) return;
  const next = [...tagEditingTags];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  tagHistory.push([...tagEditingTags]);
  tagEditingTags = next;
  renderTags();
}

if (tagEditor) {
  tagEditor.addEventListener("dragstart", (event) => {
    const item = event.target.closest(".tag-item");
    if (!item) return;
    dragIndex = Number(item.dataset.index);
    if (!Number.isInteger(dragIndex)) return;
    item.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
  });

  tagEditor.addEventListener("dragend", (event) => {
    const item = event.target.closest(".tag-item");
    if (item) item.classList.remove("is-dragging");
    clearTagDropTarget();
    dragIndex = null;
  });

  tagEditor.addEventListener("dragover", (event) => {
    event.preventDefault();
    const item = event.target.closest(".tag-item");
    clearTagDropTarget();
    if (item) item.classList.add("is-drop-target");
  });

  tagEditor.addEventListener("drop", (event) => {
    event.preventDefault();
    const item = event.target.closest(".tag-item");
    clearTagDropTarget();
    if (!item) return;
    const toIndex = Number(item.dataset.index);
    if (!Number.isInteger(toIndex) || dragIndex === null) return;
    moveTag(dragIndex, toIndex);
    dragIndex = null;
  });
}

function setBatchSaveMode(mode) {
  batchSaveTabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
  if (batchSaveGroupPanel && batchSaveManualPanel) {
    batchSaveGroupPanel.classList.toggle("is-hidden", mode !== "group");
    batchSaveManualPanel.classList.toggle("is-hidden", mode !== "manual");
  }
}

function extractResponseText(payload) {
  const content = payload?.response?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function getImageDisplayName(imageUrl) {
  if (!imageUrl) return "未命名";
  try {
    const url = new URL(imageUrl, window.location.origin);
    const rawPath = url.searchParams.get("path");
    if (rawPath) {
      const decoded = decodeURIComponent(rawPath);
      const name = decoded.split(/[\\/]/).pop();
      if (name) return name;
    }
  } catch {
    // ignore and fallback
  }
  const fallback = imageUrl.split("/").pop();
  return fallback || "未命名";
}

const previewImageFallbackSrc = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" fill="#f1f5f9"/><rect x="60" y="72" width="200" height="136" rx="12" fill="#e2e8f0"/><circle cx="120" cy="124" r="20" fill="#cbd5e1"/><path d="M84 186l50-52 34 36 28-26 40 42" fill="none" stroke="#94a3b8" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><text x="160" y="256" text-anchor="middle" fill="#64748b" font-size="22" font-family="sans-serif">加载失败</text></svg>')}`;
const previewImageRetryLimit = 2;
const previewImageDataUrlCache = new Map();

function setPreviewImageDataUrl(resultId, dataUrl) {
  if (!resultId) return;
  if (typeof dataUrl !== "string" || dataUrl.length === 0) {
    previewImageDataUrlCache.delete(resultId);
    return;
  }
  previewImageDataUrlCache.set(resultId, dataUrl);
}

function getPreviewImageSource(item) {
  if (!item) return "";
  if (item.id && previewImageDataUrlCache.has(item.id)) {
    return previewImageDataUrlCache.get(item.id) || "";
  }
  return item.imageUrl || "";
}

function buildPreviewRetryUrl(url, retryCount) {
  try {
    const nextUrl = new URL(url, window.location.origin);
    nextUrl.searchParams.set("_img_retry", String(retryCount));
    nextUrl.searchParams.set("_img_t", String(Date.now()));
    return nextUrl.toString();
  } catch {
    const sep = String(url).includes("?") ? "&" : "?";
    return `${url}${sep}_img_retry=${retryCount}&_img_t=${Date.now()}`;
  }
}

function applyPreviewImageSource(img, imageUrl, altText = "打标图像") {
  if (!img) return;
  const source = typeof imageUrl === "string" ? imageUrl.trim() : "";
  img.alt = altText;
  img.loading = "lazy";
  img.decoding = "async";
  delete img.dataset.failed;
  img.dataset.retry = "0";

  if (!source) {
    img.dataset.failed = "true";
    img.src = previewImageFallbackSrc;
    return;
  }

  const setSource = (retryCount) => {
    img.src = retryCount > 0 ? buildPreviewRetryUrl(source, retryCount) : source;
  };

  img.onload = () => {
    delete img.dataset.failed;
  };

  img.onerror = () => {
    const retryCount = Number(img.dataset.retry || "0");
    if (retryCount < previewImageRetryLimit) {
      const nextRetry = retryCount + 1;
      img.dataset.retry = String(nextRetry);
      setSource(nextRetry);
      return;
    }

    img.onerror = null;
    img.dataset.failed = "true";
    img.src = previewImageFallbackSrc;
  };

  setSource(0);
}

function computeDispatchTimeoutMs(scheduleGroup) {
  const enabledSteps = (scheduleGroup?.steps || []).filter((step) => step.enabled !== false);
  const groupTimeout = Number(scheduleGroup?.timeoutSec);
  const fallbackTimeoutSec = Number.isFinite(groupTimeout) && groupTimeout > 0 ? groupTimeout : 60;
  const totalSec = enabledSteps.reduce((sum, step) => {
    const retries = Number.isFinite(step.retries) && step.retries > 0 ? step.retries : 0;
    const intervalSec = Number.isFinite(step.interval) && step.interval > 0 ? step.interval : 0;
    const stepTimeoutSec = Number.isFinite(step.timeoutSec) && step.timeoutSec > 0 ? step.timeoutSec : fallbackTimeoutSec;
    return sum + (retries + 1) * stepTimeoutSec + retries * intervalSec;
  }, 0);
  const withBufferSec = (totalSec > 0 ? totalSec : fallbackTimeoutSec) + 15;
  return withBufferSec * 1000;
}

function ensureResultId(item) {
  if (!item) return "";
  if (!item.id) {
    item.id = crypto.randomUUID();
  }
  return item.id;
}

function getSelectedOrAllResults(results, selectedIds) {
  const selected = results.filter((item) => selectedIds.has(item.id));
  return selected.length > 0 ? selected : results;
}

async function parseJsonResponse(resp) {
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = null;
  }
  if (!resp.ok) {
    const detail = data?.detail ? `（${data.detail}）` : "";
    const htmlHint = typeof text === "string" && text.trim().startsWith("<!DOCTYPE")
      ? "（服务返回了 HTML，请确认后端已重启并加载最新代码）"
      : "";
    const message = `${data?.error || `HTTP ${resp.status}`}${detail}${htmlHint}`;
    throw new Error(message);
  }
  if (!data || typeof data !== "object") {
    throw new Error("接口返回非 JSON 数据");
  }
  return data;
}

async function imageUrlToDataUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("读取图像失败");
  const blob = await resp.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图像转码失败"));
    reader.readAsDataURL(blob);
  });
  return { dataUrl, size: blob.size };
}

async function fetchWithTimeout(url, options, timeoutMs, abortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (abortSignal) abortSignal.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
  }
}

function updatePromptSelects() {
  const systemList = state.prompts.system || [];
  const userList = state.prompts.user || [];

  if (labelSystemPresetSelect) {
    labelSystemPresetSelect.innerHTML = "";
    if (systemList.length === 0) {
      const option = document.createElement("option");
      option.textContent = "暂无系统预设";
      option.value = "";
      labelSystemPresetSelect.appendChild(option);
    } else {
      systemList.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.name;
        labelSystemPresetSelect.appendChild(option);
      });
    }
  }

  if (retrySystemPresetSelect) {
    retrySystemPresetSelect.innerHTML = "";
    if (systemList.length === 0) {
      const option = document.createElement("option");
      option.textContent = "暂无系统预设";
      option.value = "";
      retrySystemPresetSelect.appendChild(option);
    } else {
      systemList.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.name;
        retrySystemPresetSelect.appendChild(option);
      });
    }
  }

  if (labelUserPresetSelect) {
    labelUserPresetSelect.innerHTML = "";
    if (userList.length === 0) {
      const option = document.createElement("option");
      option.textContent = "暂无用户预设";
      option.value = "";
      labelUserPresetSelect.appendChild(option);
    } else {
      userList.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.name;
        labelUserPresetSelect.appendChild(option);
      });
    }
  }

  if (retryUserPresetSelect) {
    retryUserPresetSelect.innerHTML = "";
    if (userList.length === 0) {
      const option = document.createElement("option");
      option.textContent = "暂无用户预设";
      option.value = "";
      retryUserPresetSelect.appendChild(option);
    } else {
      userList.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.name;
        retryUserPresetSelect.appendChild(option);
      });
    }
  }
}

function renderPreviewList() {
  if (!previewList) return;
  if (state.previewResults.length === 0) {
    previewList.innerHTML = "";
    previewImageDataUrlCache.clear();
    previewSelectedIds.clear();
    if (previewEmpty) previewEmpty.style.display = "block";
    return;
  }
  if (previewEmpty) previewEmpty.style.display = "none";
  previewList.innerHTML = "";
  const activeIds = new Set();

  state.previewResults.forEach((item, index) => {
    const resultId = ensureResultId(item);
    activeIds.add(resultId);
    const listCard = document.createElement("div");
    listCard.className = "result-card";
    if (previewSelectedIds.has(resultId)) listCard.classList.add("is-selected");
    listCard.dataset.index = String(index);

    const img = document.createElement("img");
    img.className = "result-thumb";
    applyPreviewImageSource(img, getPreviewImageSource(item), "打标图像");

    const body = document.createElement("div");
    body.className = "result-body";

    const meta = document.createElement("div");
    meta.className = "prompt-meta";
    const title = document.createElement("strong");
    title.textContent = getImageDisplayName(item.imageUrl);
    const actions = document.createElement("div");
    actions.className = "group-actions";

    const selectLabel = document.createElement("label");
    selectLabel.className = "row result-select";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.action = "toggle-select";
    checkbox.dataset.index = String(index);
    checkbox.checked = previewSelectedIds.has(resultId);
    const checkboxText = document.createElement("span");
    checkboxText.textContent = "选择";
    selectLabel.append(checkbox, checkboxText);

    const del = document.createElement("button");
    del.className = "ghost danger";
    del.textContent = "删除";
    del.dataset.action = "delete";
    del.dataset.index = String(index);

    actions.append(selectLabel, del);
    meta.append(title, actions);

    const content = document.createElement("div");
    content.className = "result-text";
    content.textContent = item.text || "";

    body.append(meta, content);
    listCard.append(img, body);
    previewList.appendChild(listCard);
  });

  for (const cacheId of previewImageDataUrlCache.keys()) {
    if (!activeIds.has(cacheId)) {
      previewImageDataUrlCache.delete(cacheId);
    }
  }
}

let retryResults = [];
let retryAbort = null;
let retryStopped = false;

function renderRetryList() {
  if (!retryList) return;
  if (retryResults.length === 0) {
    retryList.innerHTML = "";
    retrySelectedIds.clear();
    if (retryEmpty) retryEmpty.style.display = "block";
    return;
  }
  if (retryEmpty) retryEmpty.style.display = "none";
  retryList.innerHTML = "";
  retryResults.forEach((item, index) => {
    ensureResultId(item);
    const listCard = document.createElement("div");
    listCard.className = "result-card";
    if (retrySelectedIds.has(item.id)) listCard.classList.add("is-selected");
    listCard.dataset.index = String(index);

    const img = document.createElement("img");
    img.className = "result-thumb";
    img.src = item.imageUrl || "";
    img.alt = "补全图像";

    const body = document.createElement("div");
    body.className = "result-body";

    const meta = document.createElement("div");
    meta.className = "prompt-meta";
    const title = document.createElement("strong");
    title.textContent = item.name || "未命名";
    const actions = document.createElement("div");
    actions.className = "group-actions";

    const selectLabel = document.createElement("label");
    selectLabel.className = "row result-select";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.action = "toggle-select";
    checkbox.dataset.index = String(index);
    checkbox.checked = retrySelectedIds.has(item.id);
    const checkboxText = document.createElement("span");
    checkboxText.textContent = "选择";
    selectLabel.append(checkbox, checkboxText);

    const del = document.createElement("button");
    del.className = "ghost danger";
    del.textContent = "删除";
    del.dataset.action = "delete";
    del.dataset.index = String(index);

    actions.append(selectLabel, del);
    meta.append(title, actions);

    const content = document.createElement("div");
    content.className = "result-text";
    content.textContent = item.text || "";

    body.append(meta, content);
    listCard.append(img, body);
    retryList.appendChild(listCard);
  });
}

function renderLabelLogs() {
  if (!labelLogList) return;
  if (state.labelLogs.length === 0) {
    labelLogList.innerHTML = "";
    if (labelLogEmpty) labelLogEmpty.style.display = "block";
    return;
  }
  if (labelLogEmpty) labelLogEmpty.style.display = "none";
  labelLogList.innerHTML = "";
  const logs = [...state.labelLogs].reverse();
  logs.forEach((entry) => {
    const details = document.createElement("details");
    details.className = "log-card";
    const summary = document.createElement("summary");
    summary.className = "log-summary";
    const imageName = entry?.image?.name || "未命名";
    const okText = entry?.result?.ok ? "成功" : entry?.status === "running" ? "进行中" : "失败";
    const timeText = entry?.createdAt || "";
    summary.textContent = `${timeText} · ${imageName} · ${okText}`;
    const events = Array.isArray(entry?.events) ? entry.events : [];
    const eventWrap = document.createElement("div");
    eventWrap.className = "log-events";
    events.forEach((eventItem) => {
      const row = document.createElement("div");
      row.className = "log-event";
      const time = document.createElement("span");
      time.className = "log-event-time";
      time.textContent = eventItem.ts || "";
      const text = document.createElement("span");
      text.className = "log-event-text";
      text.textContent = eventItem.message || eventItem.type || "";
      row.append(time, text);
      eventWrap.appendChild(row);
      if (eventItem.detail) {
        const detail = document.createElement("pre");
        detail.className = "log-event-detail";
        detail.textContent = JSON.stringify(eventItem.detail, null, 2);
        eventWrap.appendChild(detail);
      }
    });
    const pre = document.createElement("pre");
    pre.className = "log-body";
    pre.textContent = JSON.stringify(entry, null, 2);
    details.append(summary, eventWrap, pre);
    labelLogList.appendChild(details);
  });
}

function renderPromptList() {
  if (!promptList) return;
  const list = state.prompts[promptMode] || [];
  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "暂无预设。";
    promptList.innerHTML = "";
    promptList.appendChild(empty);
    return;
  }
  promptList.innerHTML = "";
  list.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "prompt-card";
    card.dataset.id = item.id;

    const meta = document.createElement("div");
    meta.className = "prompt-meta";

    const title = document.createElement("strong");
    title.textContent = item.name;

    const actions = document.createElement("div");
    actions.className = "group-actions";

    const moveUp = document.createElement("button");
    moveUp.className = "ghost";
    moveUp.dataset.action = "move-up";
    moveUp.dataset.index = String(index);
    moveUp.textContent = "上移";

    const moveDown = document.createElement("button");
    moveDown.className = "ghost";
    moveDown.dataset.action = "move-down";
    moveDown.dataset.index = String(index);
    moveDown.textContent = "下移";

    const edit = document.createElement("button");
    edit.className = "ghost";
    edit.dataset.action = "edit";
    edit.dataset.id = item.id;
    edit.textContent = "编辑";

    const del = document.createElement("button");
    del.className = "ghost danger";
    del.dataset.action = "delete";
    del.dataset.id = item.id;
    del.textContent = "删除";

    actions.append(moveUp, moveDown, edit, del);
    meta.append(title, actions);

    const content = document.createElement("span");
    content.className = "muted";
    content.textContent = item.content;

    card.append(meta, content);
    promptList.appendChild(card);
  });
}

function setActivePromptTab(mode) {
  promptMode = mode;
  promptTabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
  promptListTabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
  editingPromptId = null;
  promptNameInput.value = "";
  promptContentInput.value = "";
  if (promptModeLabel) {
    promptModeLabel.textContent =
      mode === "system" ? "当前保存到：系统提示词" : "当前保存到：用户提示词";
  }
  renderPromptList();
}

savePromptBtn.addEventListener("click", async () => {
  const name = promptNameInput.value.trim();
  const content = promptContentInput.value.trim();
  if (!name || !content) return;
  const list = state.prompts[promptMode] || [];
  if (editingPromptId) {
    const target = list.find((item) => item.id === editingPromptId);
    if (!target) return;
    target.name = name;
    target.content = content;
  } else {
    list.push({ id: crypto.randomUUID(), name, content });
  }
  state.prompts[promptMode] = list;
  await saveStateNow();
  editingPromptId = null;
  promptNameInput.value = "";
  promptContentInput.value = "";
  renderPromptList();
  updatePromptSelects();
});

clearPromptBtn.addEventListener("click", () => {
  editingPromptId = null;
  promptNameInput.value = "";
  promptContentInput.value = "";
});

promptList.addEventListener("click", async (event) => {
  const target = event.target;
  const action = target.dataset.action;
  if (!action) return;
  const list = state.prompts[promptMode] || [];
  if (action === "edit") {
    const item = list.find((entry) => entry.id === target.dataset.id);
    if (!item) return;
    editingPromptId = item.id;
    promptNameInput.value = item.name;
    promptContentInput.value = item.content;
    return;
  }
  if (action === "delete") {
    if (!confirm("确认删除该预设吗？")) return;
    state.prompts[promptMode] = list.filter((entry) => entry.id !== target.dataset.id);
    await saveStateNow();
    renderPromptList();
    updatePromptSelects();
    return;
  }
  const index = Number(target.dataset.index);
  if (!Number.isFinite(index)) return;
  if (action === "move-up" && index > 0) {
    const [item] = list.splice(index, 1);
    list.splice(index - 1, 0, item);
  }
  if (action === "move-down" && index < list.length - 1) {
    const [item] = list.splice(index, 1);
    list.splice(index + 1, 0, item);
  }
  state.prompts[promptMode] = list;
  await saveStateNow();
  renderPromptList();
  updatePromptSelects();
});

promptTabs.forEach((btn) => {
  btn.addEventListener("click", () => setActivePromptTab(btn.dataset.mode));
});

promptListTabs.forEach((btn) => {
  btn.addEventListener("click", () => setActivePromptTab(btn.dataset.mode));
});

batchSaveTabs.forEach((btn) => {
  btn.addEventListener("click", () => setBatchSaveMode(btn.dataset.mode));
});

batchSaveGroupBtn.addEventListener("click", () => {
  const groupId = batchSaveGroupSelect.value;
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) {
    alert("请先选择一个文件分组。");
    return;
  }
  const ok = confirm(`确认保存到分组路径：${group.path} ？`);
  if (!ok) return;
  saveBatchResults(group.path);
});

batchSaveManualBtn.addEventListener("click", () => {
  const path = batchSavePathInput.value.trim();
  if (!path) {
    alert("请填写保存路径。");
    return;
  }
  const ok = confirm(`确认保存到路径：${path} ？`);
  if (!ok) return;
  saveBatchResults(path);
});

async function saveBatchResults(targetPath) {
  if (state.previewResults.length === 0) {
    alert("当前没有打标结果可保存。");
    return;
  }
  const resultsToSave = getSelectedOrAllResults(state.previewResults, previewSelectedIds);
  try {
    const resp = await fetch("/api/save-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetPath,
        results: resultsToSave
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "保存失败");
    alert(`保存成功，共 ${data.count} 条。\n索引文件：${data.indexPath}`);
  } catch (err) {
    alert(`保存失败：${String(err)}`);
  }
}

applySystemPresetBtn.addEventListener("click", () => {
  const id = labelSystemPresetSelect.value;
  const item = (state.prompts.system || []).find((entry) => entry.id === id);
  if (!item) return;
  labelSystemText.value = item.content;
});

applyUserPresetBtn.addEventListener("click", () => {
  const id = labelUserPresetSelect.value;
  const item = (state.prompts.user || []).find((entry) => entry.id === id);
  if (!item) return;
  labelUserText.value = item.content;
});

if (applyRetrySystemPresetBtn) {
  applyRetrySystemPresetBtn.addEventListener("click", () => {
    const id = retrySystemPresetSelect?.value;
    const item = (state.prompts.system || []).find((entry) => entry.id === id);
    if (!item || !retrySystemText) return;
    retrySystemText.value = item.content;
  });
}

if (applyRetryUserPresetBtn) {
  applyRetryUserPresetBtn.addEventListener("click", () => {
    const id = retryUserPresetSelect?.value;
    const item = (state.prompts.user || []).find((entry) => entry.id === id);
    if (!item || !retryUserText) return;
    retryUserText.value = item.content;
  });
}

let labelingAbort = null;
let labelingStopped = false;

labelStopBtn.addEventListener("click", () => {
  labelingStopped = true;
  if (labelingAbort) labelingAbort.abort();
  if (labelStatus) labelStatus.textContent = "已强制停止。";
  labelStartBtn.disabled = false;
});

labelStartBtn.addEventListener("click", async () => {
  const groupId = labelGroupSelect.value;
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) {
    alert("请先选择文件分组。");
    return;
  }
  const scheduleGroupId = labelScheduleSelect.value;
  const scheduleGroup = state.scheduleGroups.find((item) => item.id === scheduleGroupId);
  if (!scheduleGroupId) {
    alert("请先选择调度组。");
    return;
  }
  labelingStopped = false;
  labelingAbort = new AbortController();
  labelStartBtn.disabled = true;
  if (labelStatus) labelStatus.textContent = "正在读取图像列表...";
  try {
    state.previewResults = [];
    await saveStateNow();
    renderPreviewList();
    const dirPath = resolveGroupDir(group);
    const resp = await fetch("/api/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: dirPath || group.path, note: group.note || "" })
    });
    const data = await parseJsonResponse(resp);
    const images = data.images || [];
    if (images.length === 0) {
      if (labelStatus) labelStatus.textContent = "该分组下没有图像文件。";
      labelStartBtn.disabled = false;
      return;
    }
    if (!scheduleGroup) {
      alert("调度组未找到，请重新选择。");
      labelStartBtn.disabled = false;
      return;
    }
    const enabledSteps = (scheduleGroup.steps || []).filter((step) => step.enabled !== false);
    const stepMax = enabledSteps.reduce((max, step) => {
      const value = Number(step.concurrency);
      return Number.isFinite(value) && value > max ? value : max;
    }, 0);
    const groupConcurrency = Number(scheduleGroup.concurrency);
    const concurrency = stepMax > 0
      ? stepMax
      : Number.isFinite(groupConcurrency) && groupConcurrency > 0
        ? groupConcurrency
        : 1;
    const stepTimeoutMax = enabledSteps.reduce((max, step) => {
      const value = Number(step.timeoutSec);
      return Number.isFinite(value) && value > max ? value : max;
    }, 0);
    const groupTimeout = Number(scheduleGroup.timeoutSec);
    const timeoutSec = stepTimeoutMax > 0
      ? stepTimeoutMax
      : Number.isFinite(groupTimeout) && groupTimeout > 0
        ? groupTimeout
        : 120;
    const dispatchTimeoutMs = computeDispatchTimeoutMs(scheduleGroup);
    let completed = 0;
    let inFlight = 0;
    const total = images.length;
    const updateMonitor = (queueSize) => {
      if (!labelMonitor) return;
      labelMonitor.textContent = `队列 ${queueSize} · 并发 ${inFlight} · 完成 ${completed}/${total}`;
    };
    const runTask = async (image) => {
      const logEntry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        durationMs: 0,
        status: "running",
        events: [],
        image: {
          name: image.name,
          path: image.path,
          url: image.url
        },
        group: {
          id: group.id,
          path: group.path,
          note: group.note || ""
        },
        scheduleGroup: {
          id: scheduleGroup.id,
          name: scheduleGroup.name,
          systemInject: scheduleGroup.systemInject || "front",
          userInject: scheduleGroup.userInject || "front",
          systemInjectText: scheduleGroup.systemInjectText || "",
          userInjectText: scheduleGroup.userInjectText || "",
          timeoutSec: scheduleGroup.timeoutSec || null,
          concurrency: scheduleGroup.concurrency || null,
          steps: scheduleGroup.steps || []
        },
        prompt: {
          systemText: "",
          userText: ""
        },
        dispatch: {
          scheduleGroupId,
          payload: null,
          options: { concurrency: 1 },
          timeoutSec,
          imageConcurrency: concurrency
        },
        result: {
          ok: false,
          text: "",
          error: "",
          detail: "",
          meta: null
        }
      };
      const addLogEvent = (type, message, detail) => {
        logEntry.events.push({
          ts: new Date().toISOString(),
          type,
          message,
          detail
        });
      };
      state.labelLogs.push(logEntry);
      renderLabelLogs();
      queueSave();
      const startedAt = Date.now();
      inFlight += 1;
      updateMonitor(queue.length);
      if (labelStatus) {
        labelStatus.textContent = `处理中 ${completed + 1}/${images.length}，并发 ${inFlight}：${image.name}`;
      }
      if (labelingStopped) {
        inFlight = Math.max(0, inFlight - 1);
        updateMonitor(queue.length);
        return;
      }
      const systemText = labelSystemText.value.trim();
      const userText = labelUserText.value.trim();
      logEntry.prompt.systemText = systemText;
      logEntry.prompt.userText = userText;
      const userContent = [];
      const logUserContent = [];
      if (userText) {
        userContent.push({ type: "text", text: userText });
        logUserContent.push({ type: "text", text: userText });
      }
      try {
        addLogEvent("download_start", "开始下载图像", { url: image.url });
        const downloadStart = Date.now();
        if (labelingStopped) throw new Error("已强制停止");
        const { dataUrl, size } = await imageUrlToDataUrl(image.url);
        const downloadDuration = Date.now() - downloadStart;
        addLogEvent("download_done", "图像下载完成", {
          bytes: size,
          durationMs: downloadDuration
        });
        userContent.push({ type: "image_url", image_url: { url: dataUrl } });
        logUserContent.push({ type: "image_url", image_url: { url: image.url } });
        const payload = {
          model: "",
          messages: [
            ...(systemText ? [{ role: "system", content: systemText }] : []),
            { role: "user", content: userContent }
          ]
        };
        const logPayload = {
          model: "",
          messages: [
            ...(systemText ? [{ role: "system", content: systemText }] : []),
            { role: "user", content: logUserContent }
          ]
        };
        logEntry.dispatch.payload = logPayload;
        const uploadStart = Date.now();
        addLogEvent("upload_start", "开始上传请求", {
          payloadBytes: JSON.stringify(payload).length
        });
        const dispatchResp = await fetchWithTimeout(
          "/api/dispatch",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scheduleGroupId,
              payload,
              options: { concurrency: 1 }
            })
          },
          dispatchTimeoutMs,
          labelingAbort?.signal
        );
        addLogEvent("upload_done", "上传请求完成", {
          status: dispatchResp.status,
          durationMs: Date.now() - uploadStart
        });
        const rawText = await dispatchResp.text();
        let dispatchData;
        try {
          dispatchData = JSON.parse(rawText);
        } catch {
          dispatchData = null;
        }
        const errorDetail = dispatchData?.errors?.length
          ? JSON.stringify(dispatchData.errors[0])
          : rawText.slice(0, 120);
        if (dispatchData?.attempts) {
          addLogEvent("dispatch_attempts", "重试记录", {
            count: dispatchData.attempts.length,
            attempts: dispatchData.attempts
          });
        }
        const text = dispatchResp.ok && dispatchData
          ? extractResponseText(dispatchData) || "未返回文本"
          : `失败: ${dispatchData?.error || "请求失败"} ${errorDetail}`;
        const resultId = crypto.randomUUID();
        state.previewResults.push({
          id: resultId,
          imageUrl: image.url,
          text
        });
        setPreviewImageDataUrl(resultId, dataUrl);
        renderPreviewList();
        addLogEvent("result", "打标完成", {
          ok: dispatchResp.ok && !!dispatchData,
          textLength: text.length
        });
        logEntry.durationMs = Date.now() - startedAt;
        logEntry.status = dispatchResp.ok && !!dispatchData ? "ok" : "fail";
        logEntry.result = {
          ok: dispatchResp.ok && !!dispatchData,
          text,
          error: dispatchResp.ok ? "" : (dispatchData?.error || "请求失败"),
          detail: errorDetail,
          meta: dispatchData ? { step: dispatchData.step, attempt: dispatchData.attempt } : null
        };
      } catch (err) {
        const resultId = crypto.randomUUID();
        state.previewResults.push({
          id: resultId,
          imageUrl: image.url,
          text: `失败: ${String(err)}`
        });
        renderPreviewList();
        addLogEvent("error", "打标失败", { error: String(err) });
        logEntry.durationMs = Date.now() - startedAt;
        logEntry.status = "fail";
        logEntry.result = {
          ok: false,
          text: "",
          error: String(err),
          detail: "",
          meta: null
        };
      } finally {
        completed += 1;
        inFlight = Math.max(0, inFlight - 1);
        renderPreviewList();
        renderLabelLogs();
        queueSave();
        updateMonitor(queue.length);
        if (labelStatus) {
          labelStatus.textContent = `已完成 ${completed}/${images.length}，并发 ${inFlight}`;
        }
      }
    };

    const queue = [...images];
    updateMonitor(queue.length);
    const workers = Array.from({ length: Math.min(concurrency, images.length) }, async () => {
      while (queue.length > 0 && !labelingStopped) {
        const image = queue.shift();
        if (!image) return;
        await runTask(image);
      }
    });
    await Promise.all(workers);
    if (labelStatus) {
      labelStatus.textContent = labelingStopped ? "已强制停止。" : "打标完成。";
    }
  } catch (err) {
    if (labelStatus) labelStatus.textContent = `打标失败: ${String(err)}`;
  } finally {
    labelStartBtn.disabled = false;
    labelingAbort = null;
  }
});

previewList.addEventListener("click", async (event) => {
  const target = event.target;
  const actionBtn = target.closest("[data-action]");
  if (!actionBtn) return;
  const index = Number(actionBtn.dataset.index);
  if (!Number.isFinite(index)) return;
  const item = state.previewResults[index];
  if (!item) return;
  ensureResultId(item);

  if (actionBtn.dataset.action === "toggle-select") {
    if (previewSelectedIds.has(item.id)) {
      previewSelectedIds.delete(item.id);
    } else {
      previewSelectedIds.add(item.id);
    }
    renderPreviewList();
    return;
  }

  if (actionBtn.dataset.action === "delete") {
    state.previewResults.splice(index, 1);
    previewSelectedIds.delete(item.id);
    await saveStateNow();
    renderPreviewList();
  }
});

clearPreviewResultsBtn.addEventListener("click", async () => {
  if (!confirm("确认清空所有预览结果吗？")) return;
  state.previewResults = [];
  previewSelectedIds.clear();
  await saveStateNow();
  renderPreviewList();
});

clearLabelLogsBtn.addEventListener("click", async () => {
  if (!confirm("确认清空所有打标日志吗？")) return;
  state.labelLogs = [];
  await saveStateNow();
  renderLabelLogs();
});

if (retryList) {
  retryList.addEventListener("click", (event) => {
    const target = event.target;
    const actionBtn = target.closest("[data-action]");
    if (!actionBtn) return;
    const index = Number(actionBtn.dataset.index);
    if (!Number.isFinite(index)) return;
    const item = retryResults[index];
    if (!item) return;
    ensureResultId(item);

    if (actionBtn.dataset.action === "toggle-select") {
      if (retrySelectedIds.has(item.id)) {
        retrySelectedIds.delete(item.id);
      } else {
        retrySelectedIds.add(item.id);
      }
      renderRetryList();
      return;
    }

    if (actionBtn.dataset.action === "delete") {
      retryResults.splice(index, 1);
      retrySelectedIds.delete(item.id);
      renderRetryList();
    }
  });
}

if (clearRetryResultsBtn) {
  clearRetryResultsBtn.addEventListener("click", () => {
    if (!confirm("确认清空所有补全结果吗？")) return;
    retryResults = [];
    retrySelectedIds.clear();
    renderRetryList();
    retryStopped = false;
    if (retryAbort) retryAbort.abort();
    retryAbort = null;
    if (retryStartBtn) retryStartBtn.disabled = false;
    if (retryStatus) retryStatus.textContent = "已清空补全结果，可重新开始。";
    if (retryMonitor) retryMonitor.textContent = "队列 0 · 并发 0 · 完成 0/0";
  });
}

if (saveRetryResultsBtn) {
  saveRetryResultsBtn.addEventListener("click", async () => {
    const groupId = retryGroupSelect?.value;
    const group = state.groups.find((item) => item.id === groupId);
    if (!group) {
      alert("请先选择文件分组。");
      return;
    }
    if (retryResults.length === 0) {
      alert("当前没有补全结果可保存。");
      return;
    }
    const targetPath = resolveGroupDir(group) || group.path;
    const resultsToSave = getSelectedOrAllResults(retryResults, retrySelectedIds);
    const ok = confirm(`确认保存到分组路径：${targetPath} ？`);
    if (!ok) return;
    try {
      const resp = await fetch("/api/save-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetPath,
          targetNote: group.note || "",
          results: resultsToSave
        })
      });
      const data = await parseJsonResponse(resp);
      alert(`保存成功，共 ${data.count} 条。\n索引文件：${data.indexPath}`);
    } catch (err) {
      alert(`保存失败：${String(err)}`);
    }
  });
}

if (retryStopBtn) {
  retryStopBtn.addEventListener("click", () => {
    retryStopped = true;
    if (retryAbort) retryAbort.abort();
    if (retryStatus) retryStatus.textContent = "已强制停止。";
    if (retryStartBtn) retryStartBtn.disabled = false;
  });
}

if (retryStartBtn) {
  retryStartBtn.addEventListener("click", async () => {
    const groupId = retryGroupSelect?.value;
    const group = state.groups.find((item) => item.id === groupId);
    if (!group) {
      alert("请先选择文件分组。");
      return;
    }
    const scheduleGroupId = retryScheduleSelect?.value;
    const scheduleGroup = state.scheduleGroups.find((item) => item.id === scheduleGroupId);
    if (!scheduleGroupId) {
      alert("请先选择调度组。");
      return;
    }
    retryStopped = false;
    retryAbort = new AbortController();
    retryStartBtn.disabled = true;
    if (retryStatus) retryStatus.textContent = "正在读取 tag 结果...";
    try {
      retryResults = [];
      renderRetryList();
      const resp = await fetch("/api/tag-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: resolveGroupDir(group) || group.path, note: group.note || "" })
      });
      const data = await parseJsonResponse(resp);
      const results = data.results || [];
      const thresholdRaw = Number(retryMinCharsInput?.value);
      const threshold = Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : 40;
      const lengths = results.map((item) =>
        Number.isFinite(item.textLength)
          ? item.textLength
          : (item.text || "").trim().length
      );
      const minLen = lengths.length ? Math.min(...lengths) : 0;
      const maxLen = lengths.length ? Math.max(...lengths) : 0;
      const missingCount = lengths.filter((len) => len === 0).length;
      const failed = results.filter((item) => {
        const length = Number.isFinite(item.textLength)
          ? item.textLength
          : (item.text || "").trim().length;
        return length < threshold;
      });
      if (retryStatus) {
        retryStatus.textContent =
          `共 ${results.length} 个，失败 ${failed.length} 个（阈值 < ${threshold}，` +
          `最短 ${minLen}，最长 ${maxLen}，空文本 ${missingCount}）`;
      }
      retryResults = failed.map((item) => {
        const length = Number.isFinite(item.textLength)
          ? item.textLength
          : (item.text || "").trim().length;
        return {
          id: crypto.randomUUID(),
          imageUrl: item.imageUrl,
          imagePath: item.imagePath,
          textPath: item.textPath,
          name: item.name,
          text: `待处理（当前长度: ${length}）`
        };
      });
      renderRetryList();
      if (failed.length === 0) {
        if (retryStatus) retryStatus.textContent = "未找到需要补全的文件。";
        retryStartBtn.disabled = false;
        return;
      }
      const confirmMsg = `共 ${results.length} 个，失败 ${failed.length} 个（阈值 < ${threshold}）。确认开始补全？`;
      const confirmOk = confirm(confirmMsg);
      if (!confirmOk) {
        if (retryStatus) retryStatus.textContent = "已取消补全。";
        retryStartBtn.disabled = false;
        return;
      }
      if (!scheduleGroup) {
        alert("调度组未找到，请重新选择。");
        retryStartBtn.disabled = false;
        return;
      }
      const enabledSteps = (scheduleGroup.steps || []).filter((step) => step.enabled !== false);
      const stepMax = enabledSteps.reduce((max, step) => {
        const value = Number(step.concurrency);
        return Number.isFinite(value) && value > max ? value : max;
      }, 0);
      const groupConcurrency = Number(scheduleGroup.concurrency);
      const concurrency = stepMax > 0
        ? stepMax
        : Number.isFinite(groupConcurrency) && groupConcurrency > 0
          ? groupConcurrency
          : 1;
      const stepTimeoutMax = enabledSteps.reduce((max, step) => {
        const value = Number(step.timeoutSec);
        return Number.isFinite(value) && value > max ? value : max;
      }, 0);
      const groupTimeout = Number(scheduleGroup.timeoutSec);
      const timeoutSec = stepTimeoutMax > 0
        ? stepTimeoutMax
        : Number.isFinite(groupTimeout) && groupTimeout > 0
          ? groupTimeout
          : 120;
      const dispatchTimeoutMs = computeDispatchTimeoutMs(scheduleGroup);
      let completed = 0;
      let inFlight = 0;
      const total = failed.length;
      const updateMonitor = (queueSize) => {
        if (!retryMonitor) return;
        retryMonitor.textContent = `队列 ${queueSize} · 并发 ${inFlight} · 完成 ${completed}/${total}`;
      };
      const runTask = async (item, index) => {
        inFlight += 1;
        updateMonitor(queue.length);
        if (retryStatus) {
          retryStatus.textContent = `处理中 ${completed + 1}/${total}，并发 ${inFlight}：${item.name}`;
        }
        if (retryStopped) {
          inFlight = Math.max(0, inFlight - 1);
          updateMonitor(queue.length);
          return;
        }
        const systemText = retrySystemText?.value.trim() || "";
        const userText = retryUserText?.value.trim() || "";
        const userContent = [];
        if (userText) {
          userContent.push({ type: "text", text: userText });
        }
        try {
          const { dataUrl } = await imageUrlToDataUrl(item.imageUrl);
          userContent.push({ type: "image_url", image_url: { url: dataUrl } });
          const payload = {
            model: "",
            messages: [
              ...(systemText ? [{ role: "system", content: systemText }] : []),
              { role: "user", content: userContent }
            ]
          };
          const dispatchResp = await fetchWithTimeout(
            "/api/dispatch",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                scheduleGroupId,
                payload,
                options: { concurrency: 1 }
              })
            },
            dispatchTimeoutMs,
            retryAbort?.signal
          );
          const rawText = await dispatchResp.text();
          let dispatchData;
          try {
            dispatchData = JSON.parse(rawText);
          } catch {
            dispatchData = null;
          }
          const errorDetail = dispatchData?.errors?.length
            ? JSON.stringify(dispatchData.errors[0])
            : rawText.slice(0, 120);
          const text = dispatchResp.ok && dispatchData
            ? extractResponseText(dispatchData) || "未返回文本"
            : `失败: ${dispatchData?.error || "请求失败"} ${errorDetail}`;
          if (retryResults[index]) {
            retryResults[index].text = text;
          }
        } catch (err) {
          if (retryResults[index]) {
            retryResults[index].text = `失败: ${String(err)}`;
          }
        } finally {
          completed += 1;
          inFlight = Math.max(0, inFlight - 1);
          renderRetryList();
          updateMonitor(queue.length);
          if (retryStatus) {
            retryStatus.textContent = `已完成 ${completed}/${total}，并发 ${inFlight}`;
          }
        }
      };

      const queue = failed.map((item, index) => ({ item, index }));
      updateMonitor(queue.length);
      const workers = Array.from({ length: Math.min(concurrency, failed.length) }, async () => {
        while (queue.length > 0 && !retryStopped) {
          const entry = queue.shift();
          if (!entry) return;
          await runTask(entry.item, entry.index);
        }
      });
      await Promise.all(workers);
      if (retryStatus) {
        if (retryStopped) {
          retryStatus.textContent = "已强制停止。";
        } else {
          retryStatus.textContent = "补全完成，请手动选择并保存结果。";
        }
      }
    } catch (err) {
      if (retryStatus) retryStatus.textContent = `补全失败: ${String(err)}`;
    } finally {
      retryStartBtn.disabled = false;
      retryAbort = null;
    }
  });
}

function getDefaultState() {
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

function normalizeStatePayload(payload) {
  const fallback = getDefaultState();
  return {
    channels: Array.isArray(payload?.channels) ? payload.channels : fallback.channels,
    groups: Array.isArray(payload?.groups) ? payload.groups : fallback.groups,
    scheduleGroups: Array.isArray(payload?.scheduleGroups) ? payload.scheduleGroups : fallback.scheduleGroups,
    tags: payload?.tags && typeof payload.tags === "object" ? payload.tags : fallback.tags,
    globalRules: {
      minChars: Number.isFinite(payload?.globalRules?.minChars) ? payload.globalRules.minChars : fallback.globalRules.minChars,
      maxChars: Number.isFinite(payload?.globalRules?.maxChars) ? payload.globalRules.maxChars : fallback.globalRules.maxChars,
      autoRetry: payload?.globalRules?.autoRetry !== false
    },
    prompts: {
      system: Array.isArray(payload?.prompts?.system) ? payload.prompts.system : fallback.prompts.system,
      user: Array.isArray(payload?.prompts?.user) ? payload.prompts.user : fallback.prompts.user
    },
    previewResults: Array.isArray(payload?.previewResults) ? payload.previewResults : fallback.previewResults,
    labelLogs: Array.isArray(payload?.labelLogs) ? payload.labelLogs : fallback.labelLogs
  };
}

function assignState(nextState) {
  state.channels = nextState.channels;
  state.groups = nextState.groups;
  state.scheduleGroups = nextState.scheduleGroups;
  state.tags = nextState.tags;
  state.globalRules = nextState.globalRules;
  state.prompts = nextState.prompts;
  state.previewResults = nextState.previewResults;
  state.labelLogs = nextState.labelLogs;
}

function renderAllPanelsFromState() {
  syncGlobalRules();
  renderChannels();
  renderScheduleGroupSelect();
  renderScheduleGroupList();
  syncScheduleForm(state.scheduleGroups.find((item) => item.id === scheduleGroupSelect.value));
  renderScheduleSteps();
  renderGroups();
  updateChannelSelects();
  updateGroupSelects();
  updatePromptSelects();
  renderPromptList();
  renderTags();
  renderPreviewList();
  renderLabelLogs();
  renderRetryList();
}

function formatExportTimestamp(date) {
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function setConfigCenterStatus(message) {
  if (!configCenterStatus) return;
  configCenterStatus.textContent = message || "";
}

function createMutedText(message) {
  const node = document.createElement("p");
  node.className = "muted";
  node.textContent = message;
  return node;
}

function renderConfigOverview() {
  if (!configOverviewList || !configOverviewSummary) return;
  configOverviewList.textContent = "";
  if (!configOverviewData) {
    configOverviewSummary.textContent = "";
    configOverviewList.appendChild(createMutedText("暂无配置概览数据。"));
    return;
  }

  const counts = configOverviewData.counts || {};
  const prompts = counts.prompts || {};
  const globalRules = configOverviewData.globalRules || {};

  const summaryText = `渠道 ${counts.channels || 0} · 分组 ${counts.groups || 0} · 调度组 ${counts.scheduleGroups || 0}`;
  configOverviewSummary.textContent = summaryText;

  const items = [
    { key: "channels", label: "渠道数量", value: counts.channels || 0 },
    { key: "groups", label: "文件分组数量", value: counts.groups || 0 },
    { key: "scheduleGroups", label: "调度组数量", value: counts.scheduleGroups || 0 },
    { key: "prompts-system", label: "系统提示词数量", value: prompts.system || 0 },
    { key: "prompts-user", label: "用户提示词数量", value: prompts.user || 0 },
    { key: "prompts-total", label: "提示词总数", value: prompts.total || 0 },
    { key: "tags", label: "Tag 分组数量", value: counts.tags || 0 },
    { key: "logs", label: "日志数量", value: counts.logs || 0 },
    { key: "minChars", label: "最小字符数", value: Number.isFinite(globalRules.minChars) ? globalRules.minChars : 200 },
    { key: "maxChars", label: "最大字符数", value: Number.isFinite(globalRules.maxChars) ? globalRules.maxChars : 200 },
    { key: "autoRetry", label: "自动重试", value: globalRules.autoRetry === false ? "关闭" : "开启" }
  ];

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "config-overview-item";
    row.dataset.key = item.key;

    const title = document.createElement("strong");
    title.textContent = item.label;

    const value = document.createElement("span");
    value.textContent = String(item.value);

    row.append(title, value);
    configOverviewList.appendChild(row);
  });
}

function renderConfigDiagnostics() {
  if (!configDiagnosticsList || !configDiagnosticsSummary) return;
  configDiagnosticsList.textContent = "";
  if (!configDiagnosticsData) {
    configDiagnosticsSummary.textContent = "";
    configDiagnosticsList.appendChild(createMutedText("暂无配置诊断数据。"));
    return;
  }

  const summary = configDiagnosticsData.summary || {};
  const items = Array.isArray(configDiagnosticsData.items) ? configDiagnosticsData.items : [];
  configDiagnosticsSummary.textContent = `错误 ${summary.error || 0} · 警告 ${summary.warning || 0} · 信息 ${summary.info || 0}`;

  items.forEach((item, index) => {
    const level = item?.level || "info";
    const card = document.createElement("div");
    card.className = "config-diagnostics-item";
    card.classList.add(level);
    card.dataset.index = String(index);

    const title = document.createElement("strong");
    title.textContent = `[${String(level).toUpperCase()}] ${item?.code || "UNKNOWN"}`;

    const message = document.createElement("p");
    message.textContent = item?.message || "";

    card.append(title, message);
    configDiagnosticsList.appendChild(card);
  });
}

async function fetchConfigOverview() {
  const resp = await fetch("/api/config/overview");
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error || "读取配置概览失败");
  }
  configOverviewData = data;
  renderConfigOverview();
}

async function fetchConfigDiagnostics() {
  const resp = await fetch("/api/config/diagnostics");
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error || "读取配置诊断失败");
  }
  configDiagnosticsData = data;
  renderConfigDiagnostics();
}

async function refreshConfigOverview() {
  setConfigCenterStatus("正在刷新概览...");
  try {
    await fetchConfigOverview();
    setConfigCenterStatus("概览已刷新");
  } catch (err) {
    setConfigCenterStatus(`概览刷新失败: ${String(err.message || err)}`);
  }
}

async function refreshConfigDiagnostics() {
  setConfigCenterStatus("正在刷新诊断...");
  try {
    await fetchConfigDiagnostics();
    setConfigCenterStatus("诊断已刷新");
  } catch (err) {
    setConfigCenterStatus(`诊断刷新失败: ${String(err.message || err)}`);
  }
}

async function refreshConfigCenterAll() {
  setConfigCenterStatus("正在刷新配置中心...");
  try {
    await Promise.all([fetchConfigOverview(), fetchConfigDiagnostics()]);
    setConfigCenterStatus("配置中心已刷新");
  } catch (err) {
    setConfigCenterStatus(`刷新失败: ${String(err.message || err)}`);
  }
}

function exportCurrentState() {
  try {
    const payload = buildStatePayload();
    const content = JSON.stringify(payload, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `config-export-${formatExportTimestamp(new Date())}.json`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setConfigCenterStatus("配置导出成功");
  } catch (err) {
    setConfigCenterStatus(`配置导出失败: ${String(err.message || err)}`);
  }
}

function triggerImportState() {
  if (!configImportInput) {
    setConfigCenterStatus("未找到导入控件");
    return;
  }
  configImportInput.value = "";
  if (typeof configImportInput.showPicker === "function") {
    configImportInput.showPicker();
    return;
  }
  configImportInput.click();
}

async function importStateFromFile(file) {
  if (!file) return;
  const confirmed = confirm("导入将完整覆盖当前全部配置，是否继续？");
  if (!confirmed) {
    setConfigCenterStatus("已取消导入");
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const nextState = normalizeStatePayload(parsed);
    assignState(nextState);
    const saved = await saveStateNow();
    if (!saved) {
      throw new Error("保存失败");
    }
    renderAllPanelsFromState();
    await refreshConfigCenterAll();
    setConfigCenterStatus("配置导入成功");
  } catch (err) {
    setConfigCenterStatus(`配置导入失败: ${String(err.message || err)}`);
  }
}

async function clearAllState() {
  const firstConfirm = confirm("清空配置不可撤销，是否继续？");
  if (!firstConfirm) {
    setConfigCenterStatus("已取消清空");
    return;
  }
  const secondConfirm = confirm("请再次确认：将清空全部配置，是否继续？");
  if (!secondConfirm) {
    setConfigCenterStatus("已取消清空");
    return;
  }

  try {
    assignState(getDefaultState());
    const saved = await saveStateNow();
    if (!saved) {
      throw new Error("保存失败");
    }
    renderAllPanelsFromState();
    await refreshConfigCenterAll();
    setConfigCenterStatus("配置已清空");
  } catch (err) {
    setConfigCenterStatus(`清空失败: ${String(err.message || err)}`);
  }
}

if (configImportInput) {
  configImportInput.addEventListener("change", async (event) => {
    const target = event.target;
    const file = target?.files?.[0];
    await importStateFromFile(file);
    if (target) target.value = "";
  });
}

if (configCenterActions) {
  configCenterActions.addEventListener("click", (event) => {
    const target = event.target;
    const button = target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "refresh-all") {
      refreshConfigCenterAll();
      return;
    }
    if (action === "refresh-overview") {
      refreshConfigOverview();
      return;
    }
    if (action === "refresh-diagnostics") {
      refreshConfigDiagnostics();
      return;
    }
    if (action === "export-state") {
      exportCurrentState();
      return;
    }
    if (action === "import-state") {
      triggerImportState();
      return;
    }
    if (action === "clear-state") {
      clearAllState();
    }
  });
}

async function init() {
  await loadState();
  syncGlobalRules();
  renderChannels();
  renderScheduleGroupSelect();
  renderScheduleGroupList();
  syncScheduleForm(state.scheduleGroups.find((item) => item.id === scheduleGroupSelect.value));
  renderScheduleSteps();
  renderGroups();
  updateChannelSelects();
  updateGroupSelects();
  updatePromptSelects();
  renderTags();
  renderPreviewList();
  renderLabelLogs();
  renderRetryList();
  renderConfigOverview();
  renderConfigDiagnostics();
  await refreshConfigCenterAll();
  setActivePromptTab("system");
  setBatchSaveMode("group");
  if (needsPromptPersist) {
    queueSave();
    needsPromptPersist = false;
  }
}

init();
