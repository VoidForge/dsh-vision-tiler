# DSH Vision Tiler

[English](README.md) · [技术报告](docs/DSH视觉分块插件v2技术报告.md) · [密集文字基准](docs/密集文字识别五模型补充报告.md)

这是一个面向 DeepSeek Harness（DSH）视觉模型的完整覆盖图片分块插件。它会在模型读图前生成全局预览、带重叠的基础切片，以及可选的密集区域放大图。

![密集文字基准对比](assets/benchmark-comparison.png)

## 为什么需要它

DeepSeek 按图片尺寸计费，单张图片最多消耗 1024 个视觉 token：总像素小于约 544×544 的图片会被放大，更大的图片会缩放到约 1300×1300 的总像素规模。因此整页进入模型时，长收据、表格、密集小字、流程图和长截图容易丢失细节。本插件让每个局部区域获得独立图片预算，同时保证原图各部分都被覆盖。

- **100% 几何覆盖**：基础切片的并集覆盖方向校正后的每个源像素，并返回审计结果。
- **切缝重叠**：落在边缘的文字或图形仍能在相邻切片中看到。
- **内容感知切缝**：文档模式优先把横向切缝移动到低墨迹区域。
- **密集区复核**：可补充 512×512 密集区域放大图，但不替代基础覆盖。
- **有界批次**：切片过多时分批返回，避免单次图片数量过大。
- **可追踪输出**：返回原图坐标、切片角色、批次与覆盖率，批次整体附带取自 DSH DeepSeek 计费账本的 token 估算。
- **不含原生图像构建**：v0.3.0 使用纯 JavaScript 与随包 WebAssembly，规避 DSH Web 中的 `sharp`/libvips 冲突。

## 安装

要求：DeepSeek Harness 0.2.2-rc.5 或更高版本、支持图片输入的 DSH 模型配置，以及 Node.js 22 或更高版本。

固定到 GitHub 发布版本：

```shell
dsh plugin --profile web add github:VoidForge/dsh-vision-tiler#v0.3.0
dsh --profile web --dump-config
```

`v0.3.0` 标签在发布时创建；在此之前请从 `#main` 安装。

不再需要配置 `allow-build`。运行依赖已写入 `package.json`，精确版本由 `package-lock.json` 锁定；这两个文件就是 Node.js 项目对应 Python `requirements.txt` 的机制。npm 公共包尚未发布，因此当前请使用上面的 GitHub 固定版本命令。

![DSH Web 中已启用 Vision Tiler（v0.2.3 截图）](assets/dsh-web-installed-v0.2.3.png)

## 调用

让模型调用注册的 `segment_image` 工具，并读取所有返回批次：

```text
请调用 segment_image 读取 D:\images\document.png，使用 mode=document、batch_index=0。
如果 remaining_batch_indices 不为空，请读完所有剩余批次后再回答；
最后列出 uncertain_regions，并注明使用过的切片 ID。
```

| 参数 | 说明 |
|---|---|
| `path` | 绝对路径，或相对于 DSH 进程目录的路径 |
| `mode` | `auto`、`document`、`diagram` 或 `photo` |
| `strategy` | `adaptive`（默认）或 `uniform`（对照模式） |
| `batch_index` | 从 0 开始的输出批次 |

DSH profile 必须使用支持图片附件的模型。纯文本模型可以执行分块，但无法把生成的图片交给模型读取。

## 视觉 token 预算

## 配置

插件在 DSH 插件设置中提供以下选项，`models` 决定工具对当前模型是否存在。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `models` | `deepseek-flash`、`deepseek-v4.1` | 允许使用本工具的模型 id 前缀。匹配不区分大小写且按前缀进行，因此 `deepseek-v4.1` 覆盖 `deepseek-v4.1-flash-1017`，也覆盖带 provider 前缀的 `openrouter/deepseek/deepseek-v4.1-flash-1017`；更早的 `deepseek-v4-flash` 与 `deepseek-v4-pro` 默认不匹配。`*` 表示所有模型，空列表会隐藏工具。 |
| `targetTilePixels` | 589824 | 单张基础切片的目标像素面积。 |
| `overlapRatio` | 按模式 | 重叠占切片尺寸的比例：auto 0.15、document 0.18、diagram 0.2、photo 0.12。 |
| `minOverlapPixels` | 64 | 相邻切片的最小重叠像素。 |
| `maxTotalTiles` | 256 | 基础切片数量上限，超过则拒绝该图片。 |
| `maxImagesPerBatch` | 20 | 每次调用返回的图片数，含预览图。 |
| `includeOverview` | true | 是否返回缩小的全局预览。 |
| `overviewMaxEdge` | 800 | 预览图最长边，最大 4096。 |
| `defaultStrategy` | adaptive | 调用方未指定时使用的分块策略。 |
| `detailCropCount` | adaptive 1、uniform 0 | 密集区放大图数量。 |
| `detailCropSide` | 512 | 单张放大图的边长。 |

工具按模型步骤注册，切换到 `models` 之外的模型时 `segment_image` 会隐藏，而不是对已有自有图像管线的 provider 做分块。

截至 2026-11-27，`deepseek-flash` 与第三方 id `deepseek-v4.1-flash-1017` 指向同一个检查点，默认列表同时覆盖这两种写法；如果后续检查点换了 id，需要在 `models` 中补充对应前缀。

## 视觉 token 预算

每个批次返回 `estimatedVisionTokens` 与 `visionTokenCap`。估算来自 `@deepseek-ai/dsh-llm-deepseek` 的 `deepSeekImageTokens`，即 DSH 为 DeepSeek 请求计费所用的同一套账本，按 DSH 实际发送的已保存附件尺寸计算；它只适用于 DeepSeek 路由，其他 provider 有自己的计费方式。插件加载时只检查已安装包是否仍导出所需的计费函数，计费算法本身以 DSH 为准；如果 DSH 发布移除或改名这些函数，插件会以可见警告拒绝启用。

| 图片 | token |
|---|---:|
| 512×512 密集区放大图 | 184 |
| A4 页面的 565×800 预览图 | 302 |
| 768×768 基础切片（默认） | 382 |
| 800×800 预览图 | 422 |
| 1024×1024 基础切片 | 652 |
| 1302×1302 基础切片，provider 保留的最大方形 | 994 |
| 任意图片，provider 上限 | 1024 |

若 DSH 或 provider 会缩小或投影某张基础切片或密集区放大图，工具会抛出 `RangeError`，因此 `targetTilePixels` 与 `detailCropSide` 必须让每张图片保持在预算内；provider 将小于 544×544 下限的图片放大是允许的。`overviewMaxEdge` 不得超过从 DSH 导入的单边请求上限（当前为 4096）；预览图属于缩略视图，可能被投影。不缩放保证以附件存储的默认归一化预算为前提；如果 profile 调低了 `normalizedImageMaxPixels` 或 `normalizedImageMaxDimension`，已保存的切片仍可能被缩小，此时估算按保存后的尺寸计价。估算基于默认的 high/original detail 路由：模型路由设置任何 `imagePixelBudget`（例如 `low`，512×512）时计费不同，不在本插件范围内。接口返回的 `usage` 仍是最终依据。

## 实测结果

受控密集文字基准包含 4 张合成页面，每页 100 个唯一 8 位随机码。每个模型对每页独立运行 3 轮，即每组 12 次调用、1,200 个严格整码判断。这些结果早于 1024 token 模型：使用 v4/384 计费口径与插件 768 px 默认值。

| 配置 | 严格整码 F1 | 中位延迟 | 平均总 token/次 | 估算价格/次 |
|---|---:|---:|---:|---:|
| GPT-5.5 | 99.25% | 27.95 秒 | 不可观测 | Codex 订阅内，无法换算 |
| GPT-5.6 Terra | 98.67% | 25.17 秒 | 不可观测 | Codex 订阅内，无法换算 |
| **DeepSeek + 插件** | **96.44%** | **6.08 秒** | **4,970.8** | **¥0.004521**（观察缓存估算） |
| GPT-5.6 Luna | 94.99% | 27.48 秒 | 不可观测 | Codex 订阅内，无法换算 |
| DeepSeek 单图直读 | 19.68% | 6.87 秒 | 1,135.5 | ¥0.001830（估算） |

在这个任务中，插件版单次估算费用约为直读的 2.47 倍，但每 100 个正确整码的估算成本下降约 51%。视觉实验模型没有单独公开价格，因此 DeepSeek 金额按公开 V4 Flash 费率估算，不等同于最终账单。Codex 当前不暴露三种 GPT 模型的任务级视觉 token 和可计费金额，所以不猜测其价格。

### 单图 token 上限会降低读图质量吗？

会，至少在“大图 + 密集小字 + 低对比”组合下可能非常明显。同一个 DeepSeek 模型、同一提示词，仅把输入从一张缩放整图改为完整局部切片，F1 从 19.68% 提升到 96.44%。这些运行使用的是 384 token 的 v4 模型，因此该对比是针对当时计费口径下该任务的证据，不是对当前 1024 token 上限的实测，也不表示所有普通图片都应分块。

## 实现逻辑

1. PNG/JPEG/BMP/GIF/TIFF 使用 Jimp 解码，WebP 使用随包 WASM 解码。
2. 应用 EXIF 方向，并拒绝超过 1 亿像素的异常图片。
3. 生成全局缩略图。
4. 规划带重叠的切片，使其并集覆盖完整原图。
5. 自适应文档模式把切缝移向低密度行，并可选取密集区放大。
6. 审计覆盖率、编码 PNG 附件，并按批返回坐标和状态。

插件保证的是几何意义上的像素覆盖，不能保证模型语义上识别每个字符。模糊、压缩伪影、异常字体和模型错误仍需人工复核。

## 证据与复现

- [v2 技术报告](docs/DSH视觉分块插件v2技术报告.md)
- [五模型密集文字补充报告](docs/密集文字识别五模型补充报告.md)
- [密集文字原始矩阵](benchmarks/dense-text-matrix.json)
- [五模型原始矩阵](benchmarks/five-model-matrix.json)
- [实验运行说明](experiment/README.md)

公开仓库包含汇总结果和可复现生成器，不包含 API 密钥或本地缓存。

## 开发与测试

```shell
npm install
npm test
npm pack
```

测试覆盖几何完整性、切缝重叠、安全上限、确定性批次、自适应密集区域、WebP/WASM、EXIF 方向和 DSH 工具渲染。参与开发请看 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题请看 [SECURITY.md](SECURITY.md)。

## 许可证

MIT
