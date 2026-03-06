# rsync-browser

一个本地只读 GUI，用来浏览 rsync 模块中的目录和文件。

## 安装

全局安装后，可以直接使用 `rsyncui` 命令启动：

```bash
npm install -g rsync-browser
rsyncui
```

如果不想自动打开浏览器：

```bash
rsyncui --no-open
```

## 默认目标

默认等价于浏览下面这个命令对应的远端模块：

```bash
/opt/homebrew/bin/rsync -av --password-file=/path/to/your-rsync-password.passwd your-username@your-rsync-host.example.com::your-rsync-module/
```

## 本地开发启动

```bash
npm start
```

启动后访问：

```text
http://127.0.0.1:3000
```

默认会启动本地服务；如果使用 `rsyncui`，还会自动打开浏览器。

## 可选环境变量

- `PORT`: 服务端口，默认 `3000`
- `HOST`: 监听地址，默认 `127.0.0.1`
- `RSYNC_BIN`: rsync 可执行文件，默认 `/opt/homebrew/bin/rsync`
- `RSYNC_PASSWORD_FILE`: 密码文件路径，默认 `/tmp/test.passwd`
- `RSYNC_REMOTE`: 远端 rsync 模块，默认 `your-username@your-rsync-host.example.com::your-rsync-module`
- `RSYNC_BROWSER_CONFIG_DIR`: 配置目录，默认 `~/.config/rsync-browser`
- `RSYNC_BROWSER_CONFIG_PATH`: 配置文件路径，默认 `~/.config/rsync-browser/config.json`

示例：

```bash
HOST=127.0.0.1 PORT=3001 RSYNC_PASSWORD_FILE=/tmp/test.passwd npm start
```

## 配置文件

配置默认保存到：

```text
~/.config/rsync-browser/config.json
```

这样无论是源码运行还是全局安装，都可以复用同一份配置。

## 功能

- 浏览当前目录
- 点击目录进入子目录
- 面包屑跳转
- 返回上级
- 刷新当前目录
- 显示文件大小、修改时间、权限
- 显示 rsync 错误信息
