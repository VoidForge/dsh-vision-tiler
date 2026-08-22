# DSH Vision Tiler

为 DeepSeek Harness（DSH）提供高分辨率图片分块读取能力的 Cordis 插件。它会在图片进入视觉模型前生成一张全局预览、带重叠的完整覆盖切片，以及可选的密集区域放大图，减少长文档、表格和密集小字因整图缩放造成的信息损失。

## 核心能力

- **完整覆盖**：基础切片的矩形并集精确覆盖方向校正后的原图，插件会返回可审计的覆盖率。
- **边界重叠**：相邻切片保留重叠区域，降低文字或图形恰好落在切缝上的风险。
- **自适应切缝**：文档模式优先把横向切缝移到低墨迹密度区域，尽量避开文字行。
- **密集区复核**：默认补充一个 512×512 高密度区域放大图；它只做补充，不替代完整覆盖切片。
- **批次读取**：当图片较多时按批返回，避免一次塞入过多视觉输入。
- **可追踪输出**：每张切片都带原图坐标、角色、批次、覆盖率和保守视觉 token 上限。

## 与 Cordis / Harness 的对应关系

实现遵循 [Cordis 插件教程](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/) 和 [Harness 工具开发说明](https://deepseek-harness.github.io/deepseek-harness/develop/basic/tool)：

- 通过 `apply(ctx, config)` 安装插件，并用 `inject = ['tools', 'attachments']` 声明服务依赖。
- 通过 `ctx.tools.register(defineTool(...))` 注册 `segment_image` 工具。
- 使用 `output.schema` 定义稳定的结构化结果，使用 `output.render` 生成持久化内容块。
- 在 `package.json` 中声明 `dsh.bundle.patch`，由 `cordis.patch.yml` 把插件写入 Harness 配置。
- 工具注册由 Cordis 生命周期管理，插件卸载时会自动执行 disposer。

## 安装

### 从 GitHub 安装

```powershell
dsh plugin --profile web add github:zyh20041227/improved_vision_for_deepseek
dsh --profile web --dump-config
```

生产环境建议固定到明确提交，避免仓库后续更新改变运行结果：

```powershell
dsh plugin --profile web add github:zyh20041227/improved_vision_for_deepseek#<commit-sha>
```

Git 依赖会执行本仓库的 `prepare` 构建脚本。pnpm 10 及以上版本可能阻止依赖构建；如果 DSH 输出 `Ignored build scripts`，请把它打印出的**完整且精确的包键**加入该 profile 的 `pnpm-workspace.yaml` 中 `allowBuilds`，再重新安装。不要凭包名猜测这个键。

### 从本地压缩包安装

```powershell
npm install
npm run build
npm pack
dsh plugin --profile web add .\local-dsh-vision-tiler-0.2.2.tgz
dsh --profile web --dump-config
```

压缩包包含预编译的 `lib/`，适合不希望在 DSH 安装阶段构建源码的环境。

## 使用

### 选择真正的视觉模型

DeepSeek Harness 默认的 `deepseek-v4-flash` 路由只声明文本输入。要让模型实际看到 `segment_image` 返回的附件，需要把 profile 的默认模型切换为官方视觉实验模型：

```yaml
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash-vision-exp
```

把这段配置写入对应 profile 的 `cordis.patch.yml`。如果仍使用纯文本模型，几何分块可以成功，但 Harness 会省略模型不支持的图片附件。

让 DSH 调用 `segment_image`，从第 0 批开始读取；如果返回剩余批次，再逐批继续：

```text
请调用 segment_image 读取 D:\images\document.png，先使用 batch_index=0；
如果返回 remaining_batch_indices，请逐批读取完毕后再回答，并列出 uncertain_regions。
```

主要参数：

| 参数 | 说明 |
|---|---|
| `path` | 绝对路径，或相对于 DSH 进程工作目录的路径 |
| `mode` | `auto`、`document`、`diagram` 或 `photo` |
| `strategy` | `adaptive`（默认）或 `uniform`（对照模式） |
| `batch_index` | 从 0 开始的图片批次 |

输出包含全局预览、基础覆盖切片、可选 `DETAIL` 放大图、原图坐标、覆盖审计、剩余批次，以及 `图片数 × 384` 的保守视觉 token 上限。

## 效果摘要

密集文字实验每种配置运行 12 次，字符级 F1 如下。这里的 token 是 API 返回或按官方 384 token/图规则计算的总输入/输出消耗；不同模型平台的统计口径并不完全等价。

| 配置 | 字符 F1 | 中位延迟 | 平均 token/次 |
|---|---:|---:|---:|
| DeepSeek 直接整图 | 19.68% | 6.87 秒 | 1,136 |
| **DeepSeek + 本插件** | **96.44%** | **6.08 秒** | **4,971** |
| GPT-5.5 | 99.25% | 27.95 秒 | 平台口径见报告 |
| GPT-5.6 Terra | 98.67% | 25.17 秒 | 平台口径见报告 |
| GPT-5.6 Luna | 94.99% | 27.48 秒 | 平台口径见报告 |

完整方法、原始矩阵与限制见：

- [`docs/DSH视觉分块插件v2技术报告.md`](docs/DSH视觉分块插件v2技术报告.md)
- [`docs/密集文字识别五模型补充报告.md`](docs/密集文字识别五模型补充报告.md)
- [`benchmarks/dense-text-matrix.json`](benchmarks/dense-text-matrix.json)
- [`benchmarks/five-model-matrix.json`](benchmarks/five-model-matrix.json)

## 开发与测试

```powershell
npm install
npm test
```

测试覆盖自适应切缝、完整覆盖审计、批次切分、工具输出和渲染行为。数据集、API 密钥和本地实验缓存不会提交到仓库。

### Windows 实测说明

本项目在 Windows、Node 22.23.2、DSH 0.1.1-rc.2 上完成了端到端验证。该版本 DSH 自带的 `@deepseek-ai/dsh-attachment-local` 在测试机加载 `sharp 0.35.3` 时出现 `ERR_DLOPEN_FAILED`；独立测试运行时将这项 DSH 传递依赖固定为 `sharp 0.34.5` 后可正常启动。这是 DSH 附件模块的 Windows 二进制兼容问题，不是 `segment_image` 的几何分块错误；上游修复后应移除该临时覆盖。

## 边界与限制

插件能保证的是几何意义上的像素覆盖，并通过重叠和放大降低信息损失；它不能保证视觉模型语义上正确识别每个可见字符。模糊、压缩伪影、异常字体和模型本身的识别错误仍可能存在，因此关键任务应检查 `seen_tiles`、`edge_checks` 和 `uncertain_regions`，必要时对原始区域做人工复核。
