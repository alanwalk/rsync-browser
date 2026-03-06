const state = {
  currentPath: "",
  entries: [],
  config: null,
  isConfigured: false,
  view: "setup",
};

const browserPanel = document.getElementById("browserPanel");
const configPanel = document.getElementById("configPanel");
const fileTable = document.getElementById("fileTable");
const breadcrumb = document.getElementById("breadcrumb");
const remoteTarget = document.getElementById("remoteTarget");
const rsyncBin = document.getElementById("rsyncBin");
const statusText = document.getElementById("statusText");
const errorBox = document.getElementById("globalErrorBox");
const refreshButton = document.getElementById("refreshButton");
const upButton = document.getElementById("upButton");
const toggleConfigButton = document.getElementById("toggleConfigButton");
const emptyState = document.getElementById("emptyState");
const configForm = document.getElementById("configForm");
const passwordFileInput = document.getElementById("passwordFileInput");
const userInput = document.getElementById("userInput");
const hostInput = document.getElementById("hostInput");
const moduleInput = document.getElementById("moduleInput");
const rsyncBinInput = document.getElementById("rsyncBinInput");
const cancelConfigButton = document.getElementById("cancelConfigButton");
const saveConfigButton = document.getElementById("saveConfigButton");

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function hideError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

function applyView() {
  const showBrowser = state.isConfigured && state.view === "browser";
  const showConfig = !showBrowser;
  const canCancel = state.isConfigured && state.view === "setup";

  browserPanel.classList.toggle("hidden", !showBrowser);
  configPanel.classList.toggle("hidden", !showConfig);
  cancelConfigButton.classList.toggle("hidden", !canCancel);
}

function setView(nextView) {
  state.view = nextView;
  applyView();
}

function setLoading(loading) {
  refreshButton.disabled = loading;
  toggleConfigButton.disabled = loading;
  upButton.disabled = loading || !state.currentPath;
  statusText.textContent = loading ? "加载中" : "已就绪";
}

function setConfigLoading(loading) {
  saveConfigButton.disabled = loading;
  cancelConfigButton.disabled = loading;
  passwordFileInput.disabled = loading;
  userInput.disabled = loading;
  hostInput.disabled = loading;
  moduleInput.disabled = loading;
  rsyncBinInput.disabled = loading;
}

function renderConfig(config) {
  state.config = config;
  remoteTarget.textContent = config.remote;
  rsyncBin.textContent = config.rsyncBin;
  passwordFileInput.value = config.passwordFile;
  userInput.value = config.user;
  hostInput.value = config.host;
  moduleInput.value = config.module;
  rsyncBinInput.value = config.rsyncBin;
}

function renderBreadcrumb() {
  const parts = state.currentPath ? state.currentPath.split("/") : [];
  const items = ['<button data-path="" class="crumb active">/</button>'];

  parts.forEach((part, index) => {
    const path = parts.slice(0, index + 1).join("/");
    items.push('<span class="crumb-sep">/</span>');
    items.push(
      `<button data-path="${escapeHtml(path)}" class="crumb">${escapeHtml(part)}</button>`
    );
  });

  breadcrumb.innerHTML = items.join("");
}

function renderTable() {
  fileTable.innerHTML = "";

  if (!state.entries.length) {
    fileTable.appendChild(emptyState.content.cloneNode(true));
    return;
  }

  state.entries.forEach((entry) => {
    const row = document.createElement("tr");
    const nextPath = state.currentPath ? `${state.currentPath}/${entry.name}` : entry.name;
    const isDir = entry.type === "directory";

    row.innerHTML = `
      <td>
        ${
          isDir
            ? `<button class="file-link" data-path="${escapeHtml(nextPath)}">📁 ${escapeHtml(entry.name)}</button>`
            : `<span class="file-name">📄 ${escapeHtml(entry.name)}</span>`
        }
      </td>
      <td>${isDir ? "目录" : "文件"}</td>
      <td>${isDir ? "-" : formatBytes(entry.size)}</td>
      <td>${escapeHtml(entry.modifiedAt)}</td>
      <td><code>${escapeHtml(entry.permissions)}</code></td>
    `;

    fileTable.appendChild(row);
  });
}

async function loadConfig() {
  setConfigLoading(true);
  hideError();

  try {
    const response = await fetch("/api/config");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "配置加载失败");
    }

    state.isConfigured = Boolean(payload.isConfigured);
    renderConfig(payload.config);
    setView(state.isConfigured ? "browser" : "setup");
  } catch (error) {
    state.isConfigured = false;
    setView("setup");
    showError(error.message);
  }

  setConfigLoading(false);
}

async function loadPath(path = "") {
  if (!state.isConfigured) {
    return;
  }

  setLoading(true);
  hideError();

  try {
    const response = await fetch(`/api/list?path=${encodeURIComponent(path)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "加载失败");
    }

    state.currentPath = payload.currentPath;
    state.entries = payload.entries;
    renderConfig(payload.config);
    renderBreadcrumb();
    renderTable();
  } catch (error) {
    showError(error.message);
    state.entries = [];
    renderBreadcrumb();
    renderTable();
    statusText.textContent = "请求失败";
    setLoading(false);
    return;
  }

  setLoading(false);
}

async function saveConfig(event) {
  event.preventDefault();
  setConfigLoading(true);
  hideError();

  const nextConfig = {
    passwordFile: passwordFileInput.value.trim(),
    user: userInput.value.trim(),
    host: hostInput.value.trim(),
    module: moduleInput.value.trim(),
    rsyncBin: rsyncBinInput.value.trim(),
  };

  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(nextConfig),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "配置保存失败");
    }

    state.isConfigured = Boolean(payload.isConfigured);
    state.currentPath = "";
    renderConfig(payload.config);
    setView("browser");
    statusText.textContent = "配置已更新";
    await loadPath("");
  } catch (error) {
    showError(error.message);
    statusText.textContent = "配置保存失败";
  }

  setConfigLoading(false);
}

refreshButton.addEventListener("click", () => loadPath(state.currentPath));

toggleConfigButton.addEventListener("click", () => {
  hideError();
  setView("setup");
});

cancelConfigButton.addEventListener("click", () => {
  hideError();
  renderConfig(state.config);
  setView("browser");
});

upButton.addEventListener("click", () => {
  if (!state.currentPath) {
    return;
  }
  const parent = state.currentPath.split("/").slice(0, -1).join("/");
  loadPath(parent);
});

breadcrumb.addEventListener("click", (event) => {
  const target = event.target.closest("[data-path]");
  if (!target) {
    return;
  }
  loadPath(target.dataset.path || "");
});

fileTable.addEventListener("click", (event) => {
  const target = event.target.closest(".file-link");
  if (!target) {
    return;
  }
  loadPath(target.dataset.path || "");
});

configForm.addEventListener("submit", saveConfig);

loadConfig().then(() => {
  if (state.isConfigured) {
    return loadPath("");
  }
  renderBreadcrumb();
  renderTable();
  return null;
});
