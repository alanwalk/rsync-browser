const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { URL } = require("url");
const { execFile } = require("child_process");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const CONFIG_DIR = process.env.RSYNC_BROWSER_CONFIG_DIR || path.join(os.homedir(), ".config", "rsync-browser");
const CONFIG_PATH = process.env.RSYNC_BROWSER_CONFIG_PATH || path.join(CONFIG_DIR, "config.json");

const DEFAULTS = {
  rsyncBin: process.env.RSYNC_BIN || "/opt/homebrew/bin/rsync",
  passwordFile:
    process.env.RSYNC_PASSWORD_FILE || "/path/to/your-rsync-password.passwd",
  user: "your-username",
  host: "your-rsync-host.example.com",
  module: "your-rsync-module",
  cdnBaseUrl: process.env.RSYNC_CDN_BASE_URL || "",
};

function parseRemoteTarget(input) {
  const raw = (input || "").trim().replace(/\/+$/, "");
  const match = raw.match(/^([^@]+)@([^:]+)::(.+)$/);

  if (!match) {
    return null;
  }

  return {
    user: match[1],
    host: match[2],
    module: match[3],
  };
}

const envRemote = parseRemoteTarget(process.env.RSYNC_REMOTE);
if (envRemote) {
  Object.assign(DEFAULTS, envRemote);
}

function readStoredConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

const storedConfig = readStoredConfig();

function normalizeConfig(input) {
  const config = {
    rsyncBin: String(input.rsyncBin || "").trim(),
    passwordFile: String(input.passwordFile || "").trim(),
    user: String(input.user || "").trim(),
    host: String(input.host || "").trim(),
    module: String(input.module || "").trim().replace(/^\/+|\/+$/g, ""),
    cdnBaseUrl: String(input.cdnBaseUrl || "").trim().replace(/\/+$/g, ""),
  };

  if (!config.rsyncBin) {
    throw new Error("Rsync 路径不能为空。");
  }
  if (!config.passwordFile) {
    throw new Error("密码文件路径不能为空。");
  }
  if (!config.user) {
    throw new Error("用户名不能为空。");
  }
  if (!config.host) {
    throw new Error("主机不能为空。");
  }
  if (!config.module) {
    throw new Error("模块名不能为空。");
  }
  if (config.module.includes("..")) {
    throw new Error("模块名不合法。");
  }
  if (config.cdnBaseUrl) {
    let parsedUrl;
    try {
      parsedUrl = new URL(config.cdnBaseUrl);
    } catch (error) {
      throw new Error("CDN 下载前缀必须是合法的 URL。");
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("CDN 下载前缀只支持 http 或 https。");
    }
  }

  return config;
}

let currentConfig = normalizeConfig({
  ...DEFAULTS,
  ...(storedConfig || {}),
});
let isConfigured = Boolean(storedConfig);

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function toClientConfig(config) {
  return {
    ...config,
    remote: `${config.user}@${config.host}::${config.module}`,
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const ext = path.extname(filePath);
    const contentType =
      {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
      }[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function normalizeRemotePath(input) {
  const raw = (input || "").trim();
  if (!raw || raw === "/") {
    return "";
  }

  const segments = raw
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);

  if (segments.some((segment) => segment === "..")) {
    throw new Error("Path traversal is not allowed.");
  }

  return segments.filter((segment) => segment !== ".").join("/");
}

function buildRemoteTarget(config, remotePath) {
  const base = `${config.user}@${config.host}::${config.module}`;
  if (!remotePath) {
    return `${base}/`;
  }
  return `${base}/${remotePath}/`;
}

function buildCdnDownloadUrl(cdnBaseUrl, remotePath) {
  const baseUrl = String(cdnBaseUrl || "").trim().replace(/\/+$/g, "");
  if (!baseUrl) {
    return "";
  }

  const encodedPath = normalizeRemotePath(remotePath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${baseUrl}/${encodedPath}`;
}

function requireCdnDownloadUrl(config, remotePath, actionLabel) {
  const cdnUrl = buildCdnDownloadUrl(config.cdnBaseUrl, remotePath);
  if (!cdnUrl) {
    throw new Error(`未配置 CDN 下载前缀，无法${actionLabel}。`);
  }
  return cdnUrl;
}

function parseRsyncLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  if (
    trimmed === "." ||
    trimmed.startsWith("receiving incremental file list") ||
    trimmed.startsWith("sent ") ||
    trimmed.startsWith("total size is ")
  ) {
    return null;
  }

  const match = line.match(
    /^([dl\-bcpDsSrwxTt+]{10,})\s+([\d,]+)\s+(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.+)$/
  );

  if (!match) {
    return null;
  }

  const [, permissions, rawSize, date, time, name] = match;
  const cleanName = name.endsWith("/") ? name.slice(0, -1) : name;
  if (!cleanName || cleanName === ".") {
    return null;
  }

  return {
    name: cleanName,
    type: permissions.startsWith("d") ? "directory" : "file",
    size: Number(rawSize.replace(/,/g, "")),
    modifiedAt: `${date} ${time}`,
    permissions,
  };
}

function listRemoteDirectory(config, remotePath) {
  const target = buildRemoteTarget(config, remotePath);
  const args = ["-v", "--list-only", "--no-recursive", `--password-file=${config.passwordFile}`, target];

  console.log(`\n[rsync] ${config.rsyncBin} ${args.join(" ")}`);

  return new Promise((resolve, reject) => {
    execFile(config.rsyncBin, args, { timeout: 30000, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[rsync] error: ${stderr.trim() || stdout.trim() || `failed with code ${error.code || "unknown"}`}`);
        reject(
          new Error(
            stderr.trim() || stdout.trim() || `rsync failed with code ${error.code || "unknown"}`
          )
        );
        return;
      }

      console.log(`[rsync] completed, ${stdout.split(/\r?\n/).filter(Boolean).length} raw lines`);
      if (stdout.trim()) {
        console.log(`[rsync] output:\n${stdout.trim()}`);
      }
      if (stderr.trim()) {
        console.error(`[rsync] stderr:\n${stderr.trim()}`);
      }

      const entries = stdout
        .split(/\r?\n/)
        .map(parseRsyncLine)
        .filter(Boolean)
        .filter((entry) => entry.name !== ".")
        .filter((entry) => !entry.name.includes("/"))
        .sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === "directory" ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

      resolve(entries);
    });
  });
}

async function readFileContent(config, remotePath) {
  const cdnUrl = requireCdnDownloadUrl(config, remotePath, "读取文件内容");
  const response = await fetch(cdnUrl, {
    redirect: "follow",
    headers: {
      Accept: "text/plain, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`CDN 读取失败: HTTP ${response.status}`);
  }

  return {
    path: remotePath,
    name: path.basename(remotePath),
    content: await response.text(),
    modifiedAt: "-",
  };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/config") {
    if (req.method === "GET") {
      sendJson(res, 200, {
        config: toClientConfig(currentConfig),
        isConfigured,
      });
      return;
    }

    if (req.method === "POST") {
      try {
        const payload = await readJsonBody(req);
        const nextConfig = normalizeConfig(payload);
        currentConfig = nextConfig;
        saveConfig(currentConfig);
        isConfigured = true;
        sendJson(res, 200, {
          message: "配置已更新",
          config: toClientConfig(currentConfig),
          isConfigured,
        });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }
  }

  if (url.pathname === "/api/list" && req.method === "GET") {
    let remotePath = "";
    try {
      remotePath = normalizeRemotePath(url.searchParams.get("path"));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }

    listRemoteDirectory(currentConfig, remotePath)
      .then((entries) => {
        sendJson(res, 200, {
          currentPath: remotePath,
          entries,
          config: toClientConfig(currentConfig),
        });
      })
      .catch((error) => {
        sendJson(res, 502, {
          error: error.message,
          currentPath: remotePath,
          config: toClientConfig(currentConfig),
        });
      });
    return;
  }

  if (url.pathname === "/api/cat" && req.method === "GET") {
    let remotePath = "";
    try {
      remotePath = normalizeRemotePath(url.searchParams.get("path"));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }

    if (!remotePath) {
      sendJson(res, 400, { error: "文件路径不能为空。" });
      return;
    }

    readFileContent(currentConfig, remotePath)
      .then((result) => {
        sendJson(res, 200, result);
      })
      .catch((error) => {
        const statusCode = currentConfig.cdnBaseUrl ? 502 : 409;
        sendJson(res, statusCode, { error: error.message, path: remotePath });
      });
    return;
  }

  if (url.pathname === "/api/download" && req.method === "GET") {
    let remotePath = "";
    try {
      remotePath = normalizeRemotePath(url.searchParams.get("path"));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }

    if (!remotePath) {
      sendJson(res, 400, { error: "文件路径不能为空。" });
      return;
    }

    try {
      const cdnUrl = requireCdnDownloadUrl(currentConfig, remotePath, "下载文件");
      res.writeHead(302, {
        Location: cdnUrl,
        "Cache-Control": "no-store",
      });
      res.end();
    } catch (error) {
      sendJson(res, 409, { error: error.message, path: remotePath });
    }
    return;
  }

  sendJson(res, 404, { error: "API endpoint not found" });
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      handleApi(req, res, url);
      return;
    }

    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    sendFile(res, filePath);
  });
}

function startServer() {
  const server = createServer();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, () => {
      server.off("error", reject);
      const address = `http://${HOST}:${PORT}`;
      console.log(`Rsync browser running on ${address}`);
      resolve({ server, address });
    });
  });
}

module.exports = {
  CONFIG_PATH,
  startServer,
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
