# 北极星 (Polaris)

将 DeepSeek Harness (`dsh`) 插件能力收敛为一组**原子能力原语**：仅保留无状态、单一职责、可组合、可验证且成本有界的最小功能单元。所有涉及状态维护、历史学习、动态调度、多轮对抗或跨模态意图理解的能力均排除在插件边界之外，交由核心调度或外部工作流处理。

- **中文名**：北极星
- **英文名**：Polaris
- **发布仓库**：https://github.com/existyay/Polaris
- **特化方向**：理工科（数学/物理/化学/工程/科研/数值/仿真）与代码优化（性能/重构/静态分析/测试质量/基准/调试）

## 原子原语清单

| 原语 | 命令 | 职责 | 边界 |
|---|---|---|---|
| 发现安装 | `/polaris-discover` | GitHub `topic:dsh-plugin` 实时发现、极简评分、一键安装 | 最多 2+2 页搜索，最多检查 96 个 package.json |
| 静态审计 | `/polaris-audit` | 静态代码扫描 + 依赖漏洞审计 | 最多 400 文件、单文件 200KB、审计超时 90s |
| 有界执行 | `/polaris-exec` | 子进程有界执行与运行时行为监控 | 硬超时、输出上限、精简环境 |
| 验证门槛 | `/polaris-verify` | 基于 schema 的确定性功能测试与覆盖率门槛 | `.polaris-verify.json`，超时/输出上限 |
| 混合检索 | `/polaris-retrieve` | 代码符号与文档混合检索 | 确定性正则，无模型，最多 400 文件 |
| 许可证 | `/polaris-license` | 项目与直接依赖许可证合规查询 | 本地静态判定 |
| 规则注入 | `/polaris-rules` | 声明式配置注入中文理工科术语映射与代码优化规则 | YAML 配置，无状态渲染 |

每个原语在 `cordis.patch.yml` 中是一个独立行（id 分别为 `polaris-*`），用户可在 profile 的 `cordis.patch.yml` 中按 id 禁用/覆盖任一原语，其余原语不受影响：

```yaml
- id: polaris-exec
  disabled: true
```

## 安装

```sh
dsh plugin --profile web add github:existyay/Polaris
dsh web
```

北极星自身是**零依赖、无构建**的纯 ESM 包，git 安装无需 `allowBuilds` 授权。

## CLI

```sh
dsh-polaris discover --scope code --top 10
dsh-polaris install --profile web --scope code --max 10 --dry-run
dsh-polaris audit --root /path/to/project
dsh-polaris exec "python -c 'print(1)'" --timeout 30000
dsh-polaris verify --root /path/to/project
dsh-polaris retrieve --root /path/to/project --query solver
dsh-polaris license --root /path/to/project
dsh-polaris rules --root /path/to/project
```

## 插件结构

```
Polaris/
├── package.json              # dsh.bundle manifest + exports（每个原语一个 subpath）
├── cordis.patch.yml          # 七个独立原子插件行
├── index.js                  # 兼容旧入口：等价于 dsh-polaris/discovery
├── plugins/
│   ├── discovery.js          # /polaris-discover
│   ├── audit.js              # /polaris-audit
│   ├── exec.js               # /polaris-exec
│   ├── verify.js             # /polaris-verify
│   ├── retrieve.js           # /polaris-retrieve
│   ├── license.js            # /polaris-license
│   └── rules.js              # /polaris-rules
├── lib/                      # 各原语核心实现（零依赖、有界）
├── bin/dsh-polaris.js        # 独立 CLI
└── skills/polaris/           # 默认规则与发现原语技能
```

## 设计约束

- **无状态**：每个原语只读输入并产生确定性输出，不维护会话状态。
- **单一职责**：一个插件只做一件事；组合由 profile patch 层完成。
- **可组合**：每个原语可通过 DSH Loader 行独立启停、替换、覆盖。
- **可验证**：`polaris-verify` 以声明式 schema 执行测试与覆盖率门槛。
- **成本有界**：每个原语都声明并强制执行文件数、文件大小、超时与输出上限。

## 安全说明

安装第三方 git 包等于授权其代码在本机运行。建议先 `dsh-polaris install --dry-run` 审阅计划，再对可信仓库执行安装。
