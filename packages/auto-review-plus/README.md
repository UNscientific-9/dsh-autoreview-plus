# dsh-experimental-auto-review-plus

DeepSeek 官方 `@deepseek-ai/dsh-experimental-auto-review` 的 Plus 派生版。

基线版本：官方 `0.2.0-rc.2`（提交 `639ed015397290b3745d163aafe02ffee4aa3f84`）。

## 这版多做了什么

| 能力 | 说明 |
|---|---|
| 安全快通道 | 能证明安全的本机普通文本读取直接放行，不请求模型；其余一律交给审查 |
| 审查方式可选 | 跟随当前会话模型、指定独立审查模型、或用 Jev 直接决策 |
| Jev 通道 | TypeSafe 官方、Command Code、自定义 HTTPS 服务；密钥按通道隔离 |
| 真实记录 | 规则放行、模型裁决、失败原因和最终执行结果都落盘，跨回合与重启保留 |
| 侧边栏页签 | 唯一入口「自动审查 Plus」：当前状态、模型选择、默认设置和真实记录 |

保留官方原有的动作快照校验、权限档位、原生与 PTC 内层执行入口、下游拒绝优先、取消和卸载机制。模型不能放行官方协议规定的高风险泄露行为。

## 安装

包内 `cordis.patch.yml` 默认 `disabled: true`，即**装上但不启用**：

```yaml
- insert:
    - id: auto-review-plus
      name: dsh-experimental-auto-review-plus
      disabled: true
```

启用前必须让官方插件让位，否则两者会同时认领审批请求：

```yaml
- id: auto-review
  disabled: true
```

插件声明 `dshWorkshop.lifecycle.activation = restart-profile`，改动后需要完整重启 DSH 才生效（关闭窗口不够，要从「应用 → 退出」退出）。

## 配置项

| 键 | 取值 | 默认 |
|---|---|---|
| `backend` | `follow` / `model` / `jev` | `follow` |
| `provider` | 模型服务名，`backend: model` 时使用 | 空 |
| `model` | 模型名，`backend: model` 时使用 | 空 |
| `safeReads` | 是否启用安全读取快通道 | `true` |
| `jevChannel` | `commandcode` / `typesafe` / `custom` | `commandcode` |
| `jevBaseUrl` | 自定义通道地址，必须 HTTPS | 空 |
| `jevModel` | 自定义通道模型名 | 空 |
| `timeoutMs` | 审查超时，1000–120000 | `15000` |
| `minConfidence` | 最低置信度，0–1 | `0.6` |
| `zdr` | 要求零数据留存 | `true` |
| `dataDirectory` | 记录目录，留空用部署目录下的私有数据区 | 空 |

密钥可通过侧边栏保存到宿主秘密设置，界面只显示是否已配置。也可按通道从宿主凭据服务或环境变量读取：

| 通道 | 变量名 |
|---|---|
| Command Code | `CMD_API_KEY`，回退 `COMMAND_CODE_API_KEY` |
| TypeSafe 官方 | `TYPESAFE_API_KEY` |
| 自定义 | `JEV_API_KEY` |

Command Code 当前不支持强制零留存。要求零留存（`zdr: true`）时插件会停止请求并说明原因，不会静默降低保护。

## 从旧版配置迁移

旧版（`dsh-auto-review`）的字段名与新版不同，不能直接照搬：

| 旧字段 | 新字段 |
|---|---|
| `decisionBackend: subagent` | `backend: follow` |
| `decisionBackend: jev` | `backend: jev` |
| `jev.preset` | `jevChannel` |
| `jev.baseUrl` | `jevBaseUrl` |
| `jev.model` | `jevModel` |
| `jev.timeoutMs` | `timeoutMs` |
| `jev.minConfidence` | `minConfidence` |
| `jev.zdr` | `zdr` |
| `jev.apiKey` | 不迁移，改由环境变量提供 |
| `reviewerProvider` | 不迁移 |
| `riskPolicy` | 新版按官方风险协议处理，无对应项 |
| `toolsPolicy` | 新版按动作实际效果分类，无对应项 |

包名也不同：旧版 `dsh-auto-review`，新版 `dsh-experimental-auto-review-plus`。

## 已知边界

- 安全快通道首版只覆盖可确定的官方工作区普通文本读取。Shell、通用写入、删除、网络发送、生产操作和未知插件能力一律进入模型审查。
- 存在自由文本指令、限制或 checkpoint 时，由模型解释其范围；不因未命中禁令关键词就自动放行。
- 外层 `run_code` 传输和 PTC 程序直接产生的 Node 效果属于官方现有覆盖边界，界面会如实标识，不承诺脚本内每一步都逐工具审查。
- 走 Command Code 通道时，审查材料（工具参数、会话摘要、工作区路径）会经过该服务。

## 构建（源码目录）

```sh
pnpm typecheck
pnpm test
pnpm build
```

沙箱禁止派生子进程时，使用已有依赖运行 `node scripts/tool.mjs vitest run --pool=threads --configLoader=native`。该方式无需安装工具或下载依赖，已通过本地沙箱验证。

## 许可

基于 DeepSeek 官方 MIT 许可证，保留版权声明。本项目由独立维护者改造，未宣称由 DeepSeek 官方发布或背书。
