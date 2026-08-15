# 北极星 (Polaris)

以 **find-skills** 为起点，定位为通用能力聚合与择优进化层：在 DeepSeek Harness 插件、第三方 MCP/Skills 与桌面新锐工具之上，持续嗅探、归一、竞技、验证、签名、索引与路由，让开发者面对单一意图接口，底层透明调度到当前最优实现。

- **中文名**：北极星
- **发布仓库**：https://github.com/existyay/Polaris
- **特化方向**：理工科（数学/物理/化学/工程/科研/数值/仿真）与代码优化（性能/重构/静态分析/测试质量/基准/调试）

## 流水线

```
异构嗅探 sniff
  ├─ dsh-plugin / MCP / Skills / CLI / desktop
  └─ 提取核心契约 → 归一化为 Polaris IR（剥离冗余依赖与权限）
        ↓
双轨竞技场 arena
  ├─ 热启动极简轨道：冒烟 + 自洽性 → 挂载到上下文辅助开发
  └─ 冷发布生产轨道：全量契约 + 模糊 + 性能基准 + SBOM 审计 + 对抗性回放
        ↓
判定门禁：效用增量必须显著优于现存最优实现
  ├─ 达标  → 可信服务签发 SLSA 出处 → GitOps PR → 不可变索引 → 语义调度器
  └─ 未达标 → 自动关闭 PR，输出差异化对比报告
        ↓
统一语义调度器 route：按意图透明路由到原生/自造/外源最优实现
```

## 当前实现

| 组件 | 命令 | 状态 |
|---|---|---|
| 异构嗅探 | `dsh-polaris sniff` / `find-skills` | ✅ 检测 DSH bundle、SKILL.md、MCP 配置、CLI bin |
| Polaris IR | `lib/ir.js` | ✅ 统一契约 + 校验 + 内容寻址摘要 |
| 双轨竞技场 | `dsh-polaris arena` | ✅ 热启动冒烟/自洽 + 冷发布契约/模糊/基准/SBOM/对抗性回放 |
| SLSA 出处 | `dsh-polaris seal` | ✅ Ed25519 签名；生产需可信签名服务托管私钥 |
| 不可变索引 + GitOps | `dsh-polaris promote` | ✅ 内容寻址条目 + index.json + git commit；远程 PR 由部署端触发 |
| 语义调度 | `dsh-polaris route` | ✅ 确定性意图路由；生产可替换为动态调度器 |

## 自动调用（安装后无需人工命令）

每个原子插件除 `/polaris-*` 命令外，还向 DSH 注册了同名**模型工具**。安装并重启 profile 后，开发 agent 在项目开发过程中会自动看到并调用这些工具：

| 工具名 | 自动触发场景 |
|---|---|
| `polaris_discover` | 寻找现成 DSH 能力，避免重复造轮子 |
| `polaris_audit` | 改动依赖、认证、动态执行等代码后自动扫描 |
| `polaris_exec` | 需要一次有界冒烟执行并监控退出/超时/输出 |
| `polaris_verify` | 任务完成前自动跑测试并执行覆盖率门槛 |
| `polaris_retrieve` | 查找函数/类/文档概念时自动检索 |
| `polaris_license` | 新增依赖或发布前自动检查许可证 |
| `polaris_rules` | 注入中文理工科术语映射与代码优化规则 |

工具描述即触发策略，模型无需人工输入命令即可在开发流程中自动调用；slash 命令保留给人类显式操作。

## DSH 原子原语

北极星在 DSH 内保持原子插件形态，每个原语独立可启停：

| id | 命令 | 职责 |
|---|---|---|
| `polaris-discovery` | `/polaris-discover` | GitHub `topic:dsh-plugin` 实时发现、极简评分、一键安装 |
| `polaris-audit` | `/polaris-audit` | 静态代码扫描 + 依赖漏洞审计 |
| `polaris-exec` | `/polaris-exec` | 有界子进程执行与运行时行为监控 |
| `polaris-verify` | `/polaris-verify` | schema 驱动确定性功能测试 + 覆盖率门槛 |
| `polaris-retrieve` | `/polaris-retrieve` | 代码符号 + 文档混合检索 |
| `polaris-license` | `/polaris-license` | 许可证合规查询 |
| `polaris-rules` | `/polaris-rules` | 声明式注入中文理工科术语映射 + 代码优化规则 |

每个原语在 `cordis.patch.yml` 中是一个独立行，可单独禁用：

```yaml
- id: polaris-exec
  disabled: true
```

## 安装

```sh
dsh plugin --profile web add github:existyay/Polaris
dsh web
```

## CLI

```sh
dsh-polaris discover --scope code --top 10
dsh-polaris install --profile web --scope code --max 10 --dry-run
dsh-polaris sniff --root /path/to/project
dsh-polaris arena --root /path/to/arena-root
dsh-polaris seal --name demo --entry node --capabilities demo,cli --persist
dsh-polaris promote --name demo --entry node --capabilities demo,cli --indexRoot /path/to/index
dsh-polaris route "code review" --indexRoot /path/to/index
```

### 竞技场配置 `.polaris-arena.json`

```json
{
  "candidate": {
    "schemaVersion": "1.0",
    "name": "demo-node",
    "version": "1.0.0",
    "origin": { "type": "cli" },
    "source": "node",
    "description": "Node.js runtime as a candidate",
    "entry": "node",
    "capabilities": ["demo", "runtime"],
    "permissions": [],
    "dependencies": [],
    "tests": {
      "smoke": ["cli-help:--help"],
      "contract": [],
      "fuzz": [],
      "benchmark": []
    }
  },
  "champion": { "name": "champion", "entry": "python3", "capabilities": ["demo"] },
  "goldenTasks": [
    { "name": "hello", "command": "{entry} -e \"console.log('hi')\"", "expect": "hi", "timeoutMs": 30000 }
  ],
  "utilityThreshold": 0.1
}
```

## 插件结构

```
Polaris/
├── package.json              # dsh.bundle manifest + exports（原子插件 subpath）
├── cordis.patch.yml          # 七个独立原子插件行
├── index.js                  # 兼容旧入口：等价于 dsh-polaris/discovery
├── plugins/                  # DSH 原子插件
├── lib/                      # 核心实现（零依赖、有界）
│   ├── ir.js                 # Polaris IR
│   ├── sniff.js              # 异构嗅探
│   ├── arena.js              # 双轨竞技场
│   ├── seal.js               # SLSA 签名
│   ├── registry.js           # 不可变索引 + GitOps
│   └── scheduler.js          # 语义调度
├── bin/dsh-polaris.js        # 独立 CLI
└── skills/polaris/           # 默认规则与发现原语技能
```

## 设计约束

- **无状态**：每个原子原语只读输入并产生确定性输出；流水线状态只存在于不可变索引中。
- **单一职责**：一个插件只做一件事；组合由 profile patch 层与流水线配置完成。
- **可组合**：DSH Loader 行、IR、索引三层均可独立替换。
- **可验证**：验证原语 + 双轨竞技场 + SLSA 出处共同构成证据链。
- **成本有界**：所有原语和流水线阶段都声明文件数、文件大小、超时与输出上限。
