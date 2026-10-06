# 官方 Auto Review Plus 开发约定

- 必须中文交流。项目基线为 DeepSeek 官方 `@deepseek-ai/dsh-experimental-auto-review`，对应来源见 `UPSTREAM.json`。
- `upstream/auto-review/` 是官方原始快照，不在此目录实现增强功能；每个文件必须保持清单中的 SHA256。
- Plus 代码落在 `packages/auto-review-plus/`，从官方快照修改。第三方 `PerryLink/dsh-auto-review` 仅供思路参考，不作为代码、依赖或执行链基线。
- 以 `DESIGN.md` 为当前产品设计。确定安全的规则放行、模型审查和最终工具执行结果必须区分并记录。
- 保留官方的动作快照校验、权限档位、原生/PTC 内层执行入口、下游拒绝优先、取消和插件卸载机制。模型不能放行官方协议规定的高风险泄露行为。
- 安全快通道只接受验证过的工具身份、实际参数和目标范围；未知、边界不明或权限冲突进入模型审查，不按工具名称一概放行。
- 使用宿主设置、凭据和界面能力。前端读取后端真实记录，不用空投影或模拟数据代替实际统计。
- 依赖、工具、缓存和编译产物保持在项目/E 盘，不安装到 C 盘。PowerShell 使用 `pwsh -NoProfile`。
- 覆盖安装文件、改变现有启用状态、删除重要数据、产生费用前，按用户安全红线说明影响、恢复方法并确认。一次真实请求的许可不包含自动重试。
- 仓库公开。提交前运行 `node scripts/check-public-files.mjs` 和 `node scripts/verify-upstream.mjs`；仅提交已核对的源码、测试、公共示例和文档，不提交本机配置、密钥、日志、会话、备份或旧第三方项目。
