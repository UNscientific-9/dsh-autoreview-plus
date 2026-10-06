# dsh-autoreview-plus

基于 DeepSeek 官方 **`@deepseek-ai/dsh-experimental-auto-review`** 改造的 Plus 项目。

当前阶段：**新设计与官方源码基线已建立，Plus 功能尚未实现、尚未替换桌面端插件。** 先前的第三方实现留在本机作为历史副本，不属于此公开仓库。

这版要提供的体验：

- 保留官方 Auto 权限档位和工具执行前的审查入口。
- 本地规则能确认安全的操作直接放行，其余操作交给审查模型。
- 可单独选择审查模型，也可用 Jev 直接决策，支持 TypeSafe、Command Code 与自定义 HTTPS 通道。
- 面板展示规则放行、模型裁决、失败原因和最终执行状态；记录跨回合和重启保留。
- 设置与下拉菜单跟随深色/浅色主题，长模型名和窄窗口下保持在可视范围内。

完整范围、界面、权限分类、交付顺序和验收条件见 [新版设计](DESIGN.md)。官方来源与版本见 [UPSTREAM.md](UPSTREAM.md)。

## 目录

```text
upstream/auto-review/       官方 0.2.0-rc.2 原始源码、测试与资源
UPSTREAM.json              来源版本、提交号与逐文件校验值
DESIGN.md                  官方 Plus 版的新设计
scripts/                   来源校验与公开提交检查
packages/auto-review-plus/  后续增强版实现位置，当前尚未建立
```

官方快照保留了 monorepo 的原始依赖声明和测试环境，不能作为独立 npm 包直接安装。本仓库当前没有提供可安装的 Plus 发行包，也没有发布 npm 包。

提交前检查（仅使用已有 Node.js 和 Git）：

```sh
node scripts/verify-upstream.mjs
node scripts/check-public-files.mjs
```

公开提交采用目录白名单，排除环境文件、密钥、日志、运行数据、依赖、构建产物与备份。提交身份使用 GitHub 的 noreply 邮箱。敏感内容检查仅输出文件和规则名称，不输出疑似密钥。

基线使用 [DeepSeek 官方 MIT 许可证](LICENSE)，保留版权声明。本项目由独立维护者改造，未宣称由 DeepSeek 官方发布或背书。
