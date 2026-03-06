const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { execFile } = require("child_process");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const CONFIG_PATH = path.join(__dirname, ".rsync-browser.config.json");

const DEFAULTS = {
  rsyncBin: process.env.RSYNC_BIN || "/opt/homebrew/bin/rsync",
  passwordFile:
    process.env.RSYNC_PASSWORD_FILE || "/path/to/your-rsync-password.passwd",
  user: "your-username",
  host: "your-rsync-host.example.com",
  module: "your-rsync-module",
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

  return config;
}

let currentConfig = normalizeConfig({
  ...DEFAULTS,
  ...(storedConfig || {}),
});
let isConfigured = Boolean(storedConfig);

function saveConfig(config) {
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

  const cleaned = raw
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("/");

  if (cleaned.includes("..")) {
    throw new Error("Path traversal is not allowed.");
  }

  return cleaned;
}

function buildRemoteTarget(config, remotePath) {
  const base = `${config.user}@${config.host}::${config.module}`;
  if (!remotePath) {
    return `${base}/`;
  }
  return `${base}/${remotePath}/`;
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
  const args = ["-av", "--list-only", `--password-file=${config.passwordFile}`, target];

  return new Promise((resolve, reject) => {
    execFile(config.rsyncBin, args, { timeout: 30000, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            stderr.trim() || stdout.trim() || `rsync failed with code ${error.code || "unknown"}`
          )
        );
        return;
      }

      const entries = stdout
        .split(/\r?\n/)
        .map(parseRsyncLine)
        .filter(Boolean)
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

  sendJson(res, 404, { error: "API endpoint not found" });
}

const server = http.createServer((req, res) => {
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

server.listen(PORT, HOST, () => {
  console.log(`Rsync browser running on http://${HOST}:${PORT}`);
});
