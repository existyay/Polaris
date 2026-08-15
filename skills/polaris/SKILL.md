# 北极星 (Polaris)

实时扫描 GitHub `topic:dsh-plugin`，按 DeepSeek Harness 极简开发范式与理工科/代码优化特化，
用最低成本一键安装符合条件的插件到 DSH profile。

## 何时使用

- 用户想发现、比较 DSH 插件（`/polaris search`）。
- 用户想批量安装经过筛选的插件（`/polaris install`）。
- 用户想审阅本地 AI 工具技能/MCP 并转化为极简插件内容（`/polaris review`）。

## 判定标准

一个仓库必须同时满足：

1. GitHub 话题包含 `dsh-plugin`；
2. 根目录 `package.json` 声明 `dsh.bundle.patch`（当前 DSH bundle 标准）；
3. 初筛文本命中理工科（数学/物理/化学/工程/科研/实验/数值/仿真等）或代码优化（性能/重构/静态分析/测试质量/基准/调试等）或极简信号（零依赖/单文件/无构建/轻量/极简等）；
4. 成本越低越好：仓库体积小、依赖少、无 `prepare` 构建门槛的优先。

## 使用方式

### DSH 命令（profile 已安装本插件）

```
/polaris search --scope all --top 8
/polaris install --profile web --scope all --max 10
/polaris install --profile web --scope code --dry-run
/polaris review /path/to/project --write
```

### 独立 CLI（未安装为 DSH 插件时）

```sh
npx github:existyay/Polaris search
npx github:existyay/Polaris install --profile web --scope code
```

CLI 与 `/polaris` 共享同一套零依赖实现。

## 安装行为

- 优先调用 `dsh plugin --profile <name> add <specs...>`，让 DSH 负责初始化 profile 与 `dsh.profile.bundles` 对账。
- 若 `dsh` 不在 PATH，则回退为 `pnpm add` 并自行对账 profile bundle。
- 对带 `prepare` 脚本的 git 依赖，安装前会把包名写入该 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`。
- 插件安装后需重启 profile 才生效。安装命令本身不修改当前运行中的会话。

## 安全说明

安装第三方 git 包等于授权其代码运行在本机。`/polaris install` 默认只安装通过筛选的少量仓库；
仍建议使用 `--dry-run` 先审阅，再对可信仓库执行安装，并尽量在安装前用 `--top` 人工确认。
