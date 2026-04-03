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
const loadingBar = document.getElementById("loadingBar");
const breadcrumbPanel = document.getElementById("breadcrumbPanel");
const emptyState = document.getElementById("emptyState");
const configForm = document.getElementById("configForm");
const passwordFileInput = document.getElementById("passwordFileInput");
const userInput = document.getElementById("userInput");
const hostInput = document.getElementById("hostInput");
const moduleInput = document.getElementById("moduleInput");
const rsyncBinInput = document.getElementById("rsyncBinInput");
const cancelConfigButton = document.getElementById("cancelConfigButton");
const saveConfigButton = document.getElementById("saveConfigButton");
const previewPanel = document.getElementById("previewPanel");
const previewTitle = document.getElementById("previewTitle");
const previewPath = document.getElementById("previewPath");
const previewSize = document.getElementById("previewSize");
const previewModified = document.getElementById("previewModified");
const previewContent = document.getElementById("previewContent");
const closePreviewButton = document.getElementById("closePreviewButton");
const toggleWrapButton = document.getElementById("toggleWrapButton");
let wrapEnabled = true;

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

function normalizePath(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
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
  const showPreview = state.view === "preview";
  const showConfig = state.view === "setup";
  const canCancel = state.isConfigured && state.view === "setup";
  const showBreadcrumb = showBrowser || showPreview;

  browserPanel.classList.toggle("hidden", !showBrowser);
  configPanel.classList.toggle("hidden", !showConfig);
  cancelConfigButton.classList.toggle("hidden", !canCancel);
  breadcrumbPanel.classList.toggle("hidden", !showBreadcrumb);
  previewPanel.classList.toggle("hidden", !showPreview);
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
  loadingBar.classList.toggle("hidden", !loading);
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
  const parts = normalizePath(state.currentPath).split("/").filter(Boolean);
  const items = ['<span role="button" tabindex="0" data-path="" class="crumb">Root</span>'];

  parts.forEach((part, index) => {
    const path = parts.slice(0, index + 1).join("/");
    const isLast = index === parts.length - 1;
    items.push('<span class="crumb-sep">/</span>');
    items.push(
      `<span role="button" tabindex="0" data-path="${escapeHtml(path)}" class="crumb${isLast ? " active" : ""}">${escapeHtml(part)}</span>`
    );
  });

  breadcrumb.innerHTML = items.join("");
}

function renderTable() {
  fileTable.innerHTML = "";

  if (!state.entries.length && !state.currentPath) {
    fileTable.appendChild(emptyState.content.cloneNode(true));
    return;
  }

  if (state.currentPath) {
    const parentRow = document.createElement("tr");
    const parentPath = normalizePath(state.currentPath).split("/").slice(0, -1).join("/");
    parentRow.className = "clickable-row";
    parentRow.dataset.path = parentPath;
    parentRow.innerHTML = `
      <td><span class="dir-entry"><span class="entry-icon" aria-hidden="true">📁</span><span class="entry-label">..</span></span></td>
      <td>目录</td>
      <td>-</td>
      <td>-</td>
      <td><code>-</code></td>
    `;
    fileTable.appendChild(parentRow);
  }

  if (!state.entries.length) {
    return;
  }

  state.entries.forEach((entry) => {
    const row = document.createElement("tr");
    const nextPath = normalizePath(
      state.currentPath ? `${state.currentPath}/${entry.name}` : entry.name
    );
    const isDir = entry.type === "directory";
    row.className = "clickable-row";
    row.dataset.path = nextPath;

    row.innerHTML = `
      <td>
        ${
          isDir
            ? `<span class="dir-entry"><span class="entry-icon" aria-hidden="true">📁</span><span class="entry-label">${escapeHtml(entry.name)}</span></span>`
            : `<span class="file-name"><span class="entry-icon" aria-hidden="true">📄</span><span class="entry-label">${escapeHtml(entry.name)}</span></span>`
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

    state.currentPath = normalizePath(payload.currentPath);
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

async function navigateTo(path) {
  const normalized = normalizePath(path);
  if (normalized === state.currentPath) {
    return;
  }
  await loadPath(normalized);
}

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".xml", ".yaml", ".yml", ".csv",
  ".js", ".ts", ".jsx", ".tsx", ".css", ".scss", ".less",
  ".html", ".htm", ".log", ".ini", ".cfg", ".conf", ".env",
  ".sh", ".bash", ".zsh", ".py", ".rb", ".go", ".rs", ".java",
  ".c", ".cpp", ".h", ".hpp", ".php", ".sql", ".toml",
]);

function isTextFile(name) {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function showPreviewLoading() {
  setView("preview");
  previewTitle.textContent = "加载中";
  previewPath.textContent = "-";
  previewSize.textContent = "-";
  previewModified.textContent = "-";
  previewContent.textContent = "正在获取文件内容...";
  previewContent.classList.toggle("wrap", wrapEnabled);
  toggleWrapButton.textContent = wrapEnabled ? "取消换行" : "自动换行";
}

function showPreviewError(name, message) {
  previewTitle.textContent = name;
  previewPath.textContent = "-";
  previewSize.textContent = "-";
  previewModified.textContent = "-";
  previewContent.textContent = message;
}

function renderPreview(data) {
  previewTitle.textContent = data.name;
  previewPath.textContent = data.path;
  previewSize.textContent = formatBytes(new TextEncoder().encode(data.content).length);
  previewModified.textContent = data.modifiedAt || "-";
  previewContent.textContent = data.content;
}

function closePreview() {
  setView("browser");
  hideError();
}

function toggleWrap() {
  wrapEnabled = !wrapEnabled;
  previewContent.classList.toggle("wrap", wrapEnabled);
  toggleWrapButton.textContent = wrapEnabled ? "取消换行" : "自动换行";
}

async function previewFile(name) {
  if (!isTextFile(name)) {
    return;
  }

  const fullPath = state.currentPath ? `${state.currentPath}/${name}` : name;
  showPreviewLoading();

  try {
    const response = await fetch(`/api/cat?path=${encodeURIComponent(fullPath)}`);
    const payload = await response.json();

    if (!response.ok) {
      showPreviewError(name, payload.error || "加载文件内容失败");
      return;
    }

    renderPreview(payload);
  } catch (error) {
    showPreviewError(name, error.message);
  }
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
  const parent = normalizePath(state.currentPath).split("/").slice(0, -1).join("/");
  navigateTo(parent);
});

breadcrumb.addEventListener("click", (event) => {
  const target = event.target.closest("[data-path]");
  if (!target) {
    return;
  }
  navigateTo(target.dataset.path || "");
});

breadcrumb.addEventListener("keydown", (event) => {
  const target = event.target.closest("[data-path]");
  if (!target) {
    return;
  }
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  navigateTo(target.dataset.path || "");
});

fileTable.addEventListener("click", (event) => {
  const target = event.target.closest("[data-path]");
  if (!target) {
    return;
  }
  const rowPath = normalizePath(target.dataset.path || "");
  const fileName = rowPath.split("/").pop() || "";
  if (isTextFile(fileName)) {
    previewFile(fileName);
    return;
  }
  navigateTo(rowPath);
});

closePreviewButton.addEventListener("click", closePreview);
toggleWrapButton.addEventListener("click", toggleWrap);

configForm.addEventListener("submit", saveConfig);

loadConfig().then(() => {
  if (state.isConfigured) {
    return loadPath("");
  }
  renderBreadcrumb();
  renderTable();
  return null;
});
