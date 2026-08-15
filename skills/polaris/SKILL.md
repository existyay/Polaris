# 北极星发现原语 (polaris-discover)

实时扫描 GitHub `topic:dsh-plugin`，按 DeepSeek Harness 极简开发范式与理工科/代码优化特化评分，并以最低成本一键安装符合条件的 DSH bundle 插件。

## 判定标准

一个仓库必须同时满足：

1. GitHub 话题包含 `dsh-plugin`；
2. 根目录 `package.json` 声明 `dsh.bundle.patch`（当前 DSH bundle 标准）；
3. 描述/话题命中理工科或代码优化或极简信号；
4. 成本有界：仓库体积小、依赖少、无 `prepare` 构建门槛的优先。

## 使用

```
/polaris-discover search --scope code --top 10
/polaris-discover install --profile web --scope code --max 10
/polaris-discover install --profile web --scope all --dry-run
```

安装优先调用 `dsh plugin --profile <name> add <specs...>`；若 `dsh` 不在 PATH，则回退为 `pnpm add` 并自行对账 `dsh.profile.bundles`。带 `prepare` 的 git 依赖会先写入 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`。

## 安全

安装第三方 git 包等于授权其代码在本机运行。先 `--dry-run` 审阅计划，再对可信仓库执行安装。
