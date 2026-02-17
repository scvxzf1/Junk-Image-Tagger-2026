# 一键部署说明（无 Docker）

本项目提供三端独立部署脚本：

- Linux：`deploy/deploy-linux.sh`
- macOS：`deploy/deploy-macos.sh`
- Windows：`deploy/deploy-windows.bat`

## 1) Linux（一键部署）

```bash
bash deploy/deploy-linux.sh
```

说明：
- 自动安装依赖（生产模式）
- 写入用户级 systemd 服务：`~/.config/systemd/user/labeler-web.service`
- 自动启动并设置开机自启（当前用户）
- 默认端口：`30101`，可通过环境变量覆盖：

```bash
PORT=30101 bash deploy/deploy-linux.sh
```

常用命令：

```bash
systemctl --user status labeler-web.service
journalctl --user -u labeler-web.service -f
systemctl --user restart labeler-web.service
systemctl --user disable --now labeler-web.service
```

## 2) macOS（一键部署）

```bash
bash deploy/deploy-macos.sh
```

说明：
- 自动安装依赖（生产模式）
- 写入 LaunchAgent：`~/Library/LaunchAgents/com.labeler.web.plist`
- 自动启动并设置登录自启（当前用户）
- 默认端口：`30101`，可通过环境变量覆盖：

```bash
PORT=30101 bash deploy/deploy-macos.sh
```

常用命令：

```bash
launchctl list | grep com.labeler.web
launchctl unload ~/Library/LaunchAgents/com.labeler.web.plist
launchctl load ~/Library/LaunchAgents/com.labeler.web.plist
tail -f ~/Library/Logs/labeler-web.out.log
```

## 3) Windows（一键部署）

在项目根目录双击运行：

- `deploy\deploy-windows.bat`

说明：
- 自动安装依赖（生产模式）
- 生成开机登录自启脚本：
  - `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\labeler-web-autostart.cmd`
- 使用 `deploy/windows-runner.ps1` 后台拉起服务
- 默认端口：`30101`，可先设置 `PORT` 环境变量后再执行

取消自启动：
- 删除 `labeler-web-autostart.cmd`

## 访问地址

统一访问：`http://127.0.0.1:30101`

若你设置了 `PORT`，请改为对应端口。
