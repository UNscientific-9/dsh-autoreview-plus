# 官方基线

此项目从 DeepSeek 官方仓库中的自动审查包派生：

| 项目 | 内容 |
|---|---|
| 官方仓库 | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| 官方包 | `@deepseek-ai/dsh-experimental-auto-review` |
| 对齐版本 | `0.2.0-rc.2` |
| 官方标签 | `dsh-v0.2.0-rc.2` |
| 提交 | `639ed015397290b3745d163aafe02ffee4aa3f84` |
| 包目录 | `packages/experimental/auto-review` |
| 许可证 | MIT，Copyright (c) 2026 DeepSeek |

[该版本的官方源码](https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84/packages/experimental/auto-review)对应 `upstream/auto-review/` 的 12 个文件。它们由 Git 标签导出，文件内容保持原样；校验值记录在 `UPSTREAM.json`。

选择此版本是为了先匹配现有桌面宿主，避免同时更换宿主接口与实现基线。后续升级官方版本时，单独记录差异并运行兼容测试。

官方原有能力包括：Auto 权限档位、原生和 PTC 内层调用审查、严格的风险/裁决协议、拒绝后的人工审批、技术失败阻止执行，以及取消和卸载生命周期管理。它默认使用当前 agent 的模型，每次受支持调用都请求模型。

Plus 首版在此执行链上增加安全规则快通道、独立模型/Jev、记录与界面；增强代码计划位于 `packages/auto-review-plus/`。新包拟名 `dsh-experimental-auto-review-plus`，独立版本从 `0.10.0` 起，不占用官方 npm scope，不替换 npm 上的官方包。

早期本机实现基于 `PerryLink/dsh-auto-review`。用户已明确纠正该方向；此公开仓库不包含该实现。其权限分级与规则放行的产品构思可参考，增强版的代码与工具执行链从上述官方包改造。
