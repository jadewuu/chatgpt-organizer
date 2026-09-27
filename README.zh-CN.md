# ChatGPT Organizer

[English](README.md) | 简体中文

使用你自己的 Codex 或 Claude Code，理解并安全整理 ChatGPT 历史记录，将对话归入 ChatGPT 原生 Projects。

## 脱敏的整理前后示例

下面的示例完全由合成数据构成，仓库不会包含维护者的真实对话数据。

| 整理前：ChatGPT 历史记录 | 审核后建议结果 |
| --- | --- |
| `调试失败的单元测试` | 移动到 `编程` |
| `制定学习计划` | 移动到 `学习` |
| `临时每周笔记` | 保持原位，或单独审核是否归档 |

只读计划会说明每条建议、置信度、当前及目标 Project，以及仍未确定的项目。只有你明确批准完全一致的计划哈希后，工具才允许修改 ChatGPT。

## 支持范围

| 历史记录来源 | v0.1 状态 |
| --- | --- |
| ChatGPT Web 历史记录 | 唯一目标；支持 macOS 和 Google Chrome；实验性 v0.1 适配器；登录及只读元数据/Project 发现已通过真实认证验收 |
| Claude Web 历史记录 | 不支持，且未经验证 |

Codex 和 Claude Code 是支持的**智能体运行环境**，不是历史记录来源。语义分析能力来自使用者自己的账号。本仓库只提供确定性的本地脚本，不包含维护者 API Key、托管后端、遥测或维护者运营的数据服务。

2026-09-26 的真实只读验收验证了专用浏览器资料登录、当前首页选择器、元数据发现和原生 Project 发现。适配器通过 `/backend-api/me` 识别账号，并将唯一观察到的 `chatgpt-account-id` 与 `/backend-api/wham/accounts/check` 确认的当前会话可访问账号绑定；本地状态只保存哈希。相关端点并非官方公开接口，仍属于实验性功能。发布版本标签前仍需完成完整消息提取和经明确批准的五项写入试运行；身份依据缺失或不明确时，程序会直接停止。

## 默认只读

环境检查、发现、分类输入、分类体系审核、计划生成和本地报告均为只读操作。创建 Project、移动对话和归档对话必须先批准未发生变化的计划。首次写入最多执行五项操作，验证通过并再次单独批准后，才能分批继续。命令和适配器均不支持删除对话或 Project。

遇到限流、访问限制、账号或工作区不一致、计划哈希变化、选择器缺失或不明确、写入期间浏览器中断，或无法确定验证结果时，程序会停止。登录成功从不等同于写入授权。

## 环境要求与安装

- macOS
- Google Chrome
- Node.js 20 或更高版本
- pnpm
- 你自己的 Codex 或 Claude Code 使用权限

```bash
git clone https://github.com/jadewuu/chatgpt-organizer.git
cd chatgpt-organizer
pnpm install
pnpm organizer doctor
```

在仓库根目录启动一种支持的智能体运行环境：

```bash
codex
```

或者：

```bash
claude
```

## 建议直接复制的首次提示词

使用 Codex 时粘贴：

> 使用此仓库的 ChatGPT Organizer 工作流。先阅读 AGENTS.md 和 chatgpt-organizer skill，检查我的环境，并优先生成只读整理计划。除非我明确批准完全一致的计划哈希，否则不要创建 Project、移动对话或归档任何内容。

使用 Claude Code 时粘贴：

> 使用此仓库的 ChatGPT Organizer 工作流。先阅读 CLAUDE.md、AGENTS.md 和 chatgpt-organizer skill，检查我的环境，并优先生成只读整理计划。除非我明确批准完全一致的计划哈希，否则不要创建 Project、移动对话或归档任何内容。

## 计划、试运行、执行、验证与清理

以下是完整工作流。登录以及只读元数据和 Project 发现已通过真实认证验收，但这不代表消息提取已经完成，也不代表用户已经授权写入：

1. **预检与登录。** 运行 `pnpm organizer doctor`。需要认证时，运行 `pnpm organizer login`，并在专用 Chrome 浏览器资料中手动登录。不要复制其他浏览器资料或 Cookie。
2. **只读发现。** 运行 `pnpm organizer discover`，然后运行 `pnpm organizer plan`。让智能体展示每个候选 Project 的代表性对话标题样本和预估数量；随后检查 `.local/plans/taxonomy.yaml`，明确批准或调整分类体系。
3. **只读提取与分类。** 发现阶段仅包含元数据。运行 `node scripts/04-read.js --all`，将消息提取到私有的 `.local/raw/conversations/` 检查点中；随后再次运行 `pnpm organizer plan`，生成 `.local/plans/classification-input.jsonl`。该兼容命令目前是消息读取入口。缺失或不完整的提取会阻止分类。你的 Codex 或 Claude Code 会分批处理首条和末条用户消息，并写入符合结构要求的 `.local/plans/classifications.json`。只有在你明确允许查看完整内容后，工具才会为低置信度对话请求额外片段。
4. **只读计划审核。** 运行 `pnpm organizer plan`，生成 `.local/plans/migration-plan.json` 和 `.local/reports/review.html`。审核分类体系、每项建议操作、未确定项目，以及页面显示的计划哈希。分类结果本身从不构成写入授权。
5. **只开启计划确实需要的写入能力。** 示例配置默认关闭所有写入操作。如果本地配置尚不存在，复制一次：

   ```bash
   cp config/organizer.example.yaml config/organizer.yaml
   ```

   `config/organizer.yaml` 已被 Git 忽略。仅开启审核后的计划确实需要的操作：

   - 只有计划包含 `createRequired: true` 的 Project 时，才设置 `allowCreateProjects: true`。
   - 只有计划包含 `action: "move"` 的对话时，才设置 `allowMove: true`。
   - 只有计划包含 `action: "archive"` 的对话时，才设置 `allowArchive: true`。
   - 其他操作保持 `false`，并始终保持 `neverDelete: true`。

   这些配置只是能力开关，不是写入授权，也不能代替对完全一致计划哈希的明确批准。
6. **明确批准的五项写入试运行。** 批准完全一致的计划哈希后，运行：

   ```bash
   organizer_plan_hash="$(node -p 'require("./.local/plans/migration-plan.json").planHash')"
   pnpm organizer apply --mode pilot --approve "$organizer_plan_hash"
   pnpm organizer verify
   ```

7. **单独批准的分批继续。** 审核已经验证的试运行结果。只有再次明确批准后，才可以按照生产批次上限继续执行同一份计划（每次最多 25 项），随后验证：

   ```bash
   pnpm organizer apply --mode resume --approve "$organizer_plan_hash"
   pnpm organizer verify
   ```

   仍有操作待执行时，每个成功验证的批次都会回到 `APPLY_APPROVAL`。审核结果，并为下一次执行重新取得完全一致计划哈希的授权。只有最终验证可以将状态标记为 `COMPLETE`。已经验证的操作不会重复执行；任何不确定结果都会停止当前批次。
8. **可选的本地清理。** 不再需要提取数据后，运行 `pnpm organizer clean:data`。命令会打印每个绝对目标路径，并要求输入准确的运行 ID。默认会保留 `.local/state` 和浏览器资料。如需一并删除专用浏览器资料，运行 `pnpm organizer clean:data --include-profile` 并完成单独的警告确认；之后需要重新登录。

## 本地数据目录

所有用户派生数据都位于被 Git 忽略的 `.local/` 目录：

```text
.local/
├── profile/   专用 Chrome 会话，包括浏览器 Cookie
├── state/     运行、账号/工作区、审批及进度状态
├── raw/       已发现的对话、Projects 和提取的消息
├── plans/     分类体系、分类输入/结果及迁移计划
├── reports/   本地审核报告
├── audit/     仅追加的写入和验证事件
└── logs/      本地诊断输出
```

Git 中只允许存在合成测试数据。分享任何产物或让模型查看完整对话内容前，请阅读 [隐私说明](PRIVACY.md)。

## 当前限制

- v0.1 只面向 macOS 和 Google Chrome 上的 ChatGPT Web。Claude Web 历史记录及其他来源均不支持且未经验证。
- 本项目是非官方的 ChatGPT Web 浏览器自动化工具，与 OpenAI 无关联；ChatGPT 修改界面或行为后，工具可能停止工作。
- 仅靠合成测试无法完全保证浏览器选择器和真实写入可靠。公开 CI 永远不会执行真实写入。
- 发现过程可以从本地检查点恢复，但触发安全停止后，必须先人工审核，才能再次申请批准写入。
- 清理选定的本地产物后无法恢复；该功能适用于已经完成或明确放弃的运行。

恢复说明见 [故障排查](docs/troubleshooting.md)，贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题请遵循 [SECURITY.md](SECURITY.md)，数据处理说明见 [PRIVACY.md](PRIVACY.md)，许可证见 [MIT License](LICENSE)。
