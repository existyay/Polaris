# 北极星 (Polaris)

实时扫描 [GitHub `dsh-plugin` 主题](https://github.com/topics/dsh-plugin)，按
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**极简开发思维**
筛选最适合的插件，并以最低成本一键安装到 DSH profile。

- **中文名**：北极星
- **英文名**：Polaris
- **发布仓库**：https://github.com/existyay/Polaris
- **特化方向**：理工科（数学/物理/化学/工程/科研/数值/仿真）与代码优化（性能/重构/静态分析/测试质量/基准/调试）

## 判定标准

一个仓库会被北极星选中，当且仅当：

1. GitHub 话题包含 `dsh-plugin`；
2. 根目录 `package.json` 声明 `dsh.bundle.patch`（当前 DSH bundle 开发标准，`.dsh-plugin` 旧格式不纳入）；
3. 仓库描述/话题命中理工科、代码优化或极简信号；
4. 成本最低优先：仓库体积小、依赖少、无 `prepare` 构建门槛的优先。

## 安装本插件

```sh
# 以 dsh bundle 形式安装北极星到 web profile
dsh plugin --profile web add github:existyay/Polaris

# 重启 profile
dsh web
```

北极星自身是**零依赖、无构建**的纯 ESM 包，git 安装无需 `allowBuilds` 授权。

## 使用

安装后，在 DSH Web UI 中直接使用 `/polaris` 命令：

```
/polaris search --scope code --top 10
/polaris install --profile web --scope all --max 10
/polaris install --profile web --scope code --dry-run
/polaris review /path/to/project --write
```

也可以使用独立 CLI：

```sh
npx github:existyay/Polaris search --scope code
npx github:existyay/Polaris install --profile web --scope code --max 10
```

`--scope` 可选：

| 值 | 含义 |
|---|---|
| `all` | 理工科 + 代码优化（默认） |
| `science` | 仅理工科 |
| `code` | 仅代码优化 |

## 子命令

### search / list

实时合并 `topic:dsh-plugin` 的 stars 与 updated 两种排序，抓取候选仓库的
`package.json`，只保留当前 `dsh.bundle.patch` 标准插件，输出评分与理由。

### install

- 优先调用 `dsh plugin --profile <name> add <specs...>`，由 DSH 负责 profile
  初始化与 `dsh.profile.bundles` 对账；
- 若 `dsh` 不在 PATH，回退为 `pnpm add` 并自行对账；
- 对带 `prepare` 脚本的 git 依赖，预先写入 profile 的
  `pnpm-workspace.yaml` 的 `allowBuilds`；
- 默认安装分数 `>= 6.0` 且排名前 `--max 10` 的插件；
- `--dry-run` 只打印安装计划，不写任何文件。

### review（后期能力，已内置第一版）

递归审阅本地 AI 工具的 `SKILL.md` 与 `mcp.json` / `.mcp.json`，按同一套
极简 + 理工科/代码优化标准打分；`--write` 将命中的技能转换为
`polaris-converted/skills/*.md`。后续可把转换产物直接注册为北极星插件的
运行时技能内容。

## 插件结构

```
Polaris/
├── package.json          # dsh.bundle manifest + zero deps
├── cordis.patch.yml      # bundle layer: mounts dsh-polaris plugin row
├── index.js              # Cordis plugin: /polaris command + polaris skill
├── lib/polaris.js        # discovery/scoring/install/review core
├── bin/dsh-polaris.js    # standalone CLI
└── skills/polaris/SKILL.md
```

## 安全说明

安装第三方 git 包等于授权其代码在本机运行。建议先
`/polaris install --dry-run` 审阅计划，再对可信仓库执行安装。
