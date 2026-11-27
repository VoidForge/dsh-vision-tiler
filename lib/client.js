"use strict";
(() => {
  // locale/en.json
  var en_default = {
    meta: {
      title: "Vision tiler",
      description: "Reads high-resolution images through the segment_image tool: one overview plus overlapping tiles, so small text survives instead of being downscaled away. Each batch returns PNG attachments and a DeepSeek vision-token estimate. The tool is offered only for the models listed in its settings, so other providers keep their own image handling. Every call adds model requests and vision tokens; disable the plugin to remove the tool."
    },
    settings: {
      loading: "Loading settings…",
      unavailable: "The Host does not expose this plugin's settings. Enable the plugin and restart DSH.",
      readOnly: "This profile stores settings read-only; the plugin keeps its current configuration.",
      intro: "These options apply to the next segment_image call.",
      save: "Save",
      saving: "Saving…",
      saveFailed: "The Host did not accept the change. Review the values and try again.",
      invalidNumber: "Enter a number within the stated range.",
      targetTilePixels: "Target tile area",
      targetTilePixelsHint: "Pixels per coverage tile. 768 × 768 costs 382 DeepSeek vision tokens.",
      overlapRatio: "Overlap ratio",
      overlapRatioHint: "0 to 0.499 of the tile. Empty uses the per-mode default: 0.15 auto, 0.18 document, 0.2 diagram, 0.12 photo.",
      minOverlapPixels: "Minimum overlap",
      minOverlapPixelsHint: "Pixels; neighbouring tiles keep at least this much shared area.",
      maxTotalTiles: "Maximum tiles",
      maxTotalTilesHint: "The tool refuses an image that needs more coverage tiles.",
      maxImagesPerBatch: "Images per call",
      maxImagesPerBatchHint: "Including the overview; the Host's own limit still applies.",
      includeOverview: "Include overview",
      includeOverviewHint: "A downscaled full-image view with every batch.",
      overviewMaxEdge: "Overview longest edge",
      overviewMaxEdgeHint: "Pixels, up to 4096.",
      defaultStrategy: "Default strategy",
      defaultStrategyHint: "Used when the caller does not pass strategy.",
      detailCropCount: "Detail crops",
      detailCropCountHint: "Dense-region crops. Empty restores the installed value, or the per-strategy default of 1 for adaptive and 0 for uniform.",
      detailCropSide: "Detail crop side",
      detailCropSideHint: "Pixels, 256 to 1024.",
      models: "Model prefixes",
      modelsHint: "One prefix per line. * allows every model; an empty list hides the tool.",
      strategyAdaptive: "Adaptive",
      strategyUniform: "Uniform"
    }
  };

  // locale/zh.json
  var zh_default = {
    meta: {
      title: "视觉分块",
      description: "通过 segment_image 工具读取高分辨率图片：先给全局预览，再给带重叠的切片，避免小字在整图缩放时丢失。每批返回 PNG 附件和该批次的 DeepSeek 视觉 token 估算。工具只对设置中列出的模型提供，其他 provider 保留自己的图像处理。每次调用会增加模型请求和视觉 token；禁用插件即可移除工具。"
    },
    settings: {
      loading: "正在加载设置…",
      unavailable: "当前 Host 没有提供此插件的设置。请启用插件并重启 DSH。",
      readOnly: "当前配置档以只读方式存储设置；插件保持现有配置。",
      intro: "这些选项对下一次 segment_image 调用生效。",
      save: "保存",
      saving: "正在保存…",
      saveFailed: "Host 未接受该修改。请检查当前值后重试。",
      invalidNumber: "请输入范围内的数字。",
      targetTilePixels: "目标切片面积",
      targetTilePixelsHint: "每张覆盖切片的像素面积。768 × 768 消耗 382 个 DeepSeek 视觉 token。",
      overlapRatio: "重叠比例",
      overlapRatioHint: "占切片边长的 0 到 0.499。留空时使用各模式默认值：auto 0.15、document 0.18、diagram 0.2、photo 0.12。",
      minOverlapPixels: "最小重叠",
      minOverlapPixelsHint: "相邻切片至少共享的像素数。",
      maxTotalTiles: "最大切片数",
      maxTotalTilesHint: "超过该数量的图像会被工具拒绝。",
      maxImagesPerBatch: "每次调用的图片数",
      maxImagesPerBatchHint: "包含全局预览；Host 自身的上限仍然生效。",
      includeOverview: "包含全局预览",
      includeOverviewHint: "每批都返回一张缩小后的整图。",
      overviewMaxEdge: "预览最长边",
      overviewMaxEdgeHint: "像素，最大 4096。",
      defaultStrategy: "默认策略",
      defaultStrategyHint: "调用方未指定 strategy 时使用。",
      detailCropCount: "密集区域切片数",
      detailCropCountHint: "密集区域放大图数量。留空时恢复安装时的值；没有安装值时 adaptive 用 1、uniform 用 0。",
      detailCropSide: "密集区域切片边长",
      detailCropSideHint: "像素，256 到 1024。",
      models: "模型前缀",
      modelsHint: "每行一个前缀。* 允许所有模型；空列表会隐藏工具。",
      strategyAdaptive: "自适应",
      strategyUniform: "均匀"
    }
  };

  // src/client-locales.ts
  var DICTIONARIES = {
    en: en_default.settings,
    zh: zh_default.settings
  };

  // src/settings-form.ts
  var MAX_OVERVIEW_EDGE = 4096;
  var FIELDS = [
    { key: "targetTilePixels", kind: "integer", min: 16384 },
    { key: "overlapRatio", kind: "number", min: 0, max: 0.499 },
    { key: "minOverlapPixels", kind: "integer", min: 1 },
    { key: "maxTotalTiles", kind: "integer", min: 1 },
    { key: "maxImagesPerBatch", kind: "integer", min: 2 },
    { key: "includeOverview", kind: "boolean" },
    { key: "overviewMaxEdge", kind: "integer", min: 1, max: MAX_OVERVIEW_EDGE },
    { key: "defaultStrategy", kind: "enum", options: ["adaptive", "uniform"] },
    { key: "detailCropCount", kind: "integer", min: 0, max: 16 },
    { key: "detailCropSide", kind: "integer", min: 256, max: 1024 },
    { key: "models", kind: "lines" }
  ];
  var EMPTY_STAGED = {
    edits: {},
    baseRevision: void 0,
    baseAccepted: null
  };
  function isEdited(edits, key) {
    return Object.prototype.hasOwnProperty.call(edits, key);
  }
  function displayValue(spec, value) {
    if (spec.kind === "boolean") return value === true;
    if (spec.kind === "lines") return Array.isArray(value) ? value.join("\n") : "";
    if (spec.kind === "enum") return typeof value === "string" ? value : String(spec.options?.[0] ?? "");
    return typeof value === "number" ? String(value) : "";
  }
  function parseField(spec, raw) {
    if (spec.kind === "boolean") return { kind: "set", value: raw === true };
    if (spec.kind === "enum") return { kind: "set", value: String(raw) };
    if (spec.kind === "lines") {
      return {
        kind: "set",
        value: String(raw).split("\n").map((line) => line.trim()).filter((line) => line !== "")
      };
    }
    const text = String(raw).trim();
    if (text === "") return { kind: "unset" };
    const value = Number(text);
    if (!Number.isFinite(value)) return { kind: "invalid" };
    if (spec.kind === "integer" && !Number.isInteger(value)) return { kind: "invalid" };
    if (spec.min !== void 0 && value < spec.min) return { kind: "invalid" };
    if (spec.max !== void 0 && value > spec.max) return { kind: "invalid" };
    return { kind: "set", value };
  }
  function editedOps(edits) {
    const ops = [];
    for (const spec of FIELDS) {
      if (!isEdited(edits, spec.key)) continue;
      const parsed = parseField(spec, edits[spec.key]);
      if (parsed.kind === "invalid") return { ops: [], invalid: true };
      ops.push(parsed.kind === "unset" ? { op: "unset", path: [spec.key] } : { op: "set", path: [spec.key], value: parsed.value });
    }
    return { ops, invalid: false };
  }
  function fieldEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  function acceptedUnchanged(keys, base, current) {
    if (base === null || current === void 0) return false;
    return keys.every((key) => fieldEqual(base[key], current[key]));
  }
  function stageEdit(state, key, value, snapshot) {
    const edits = { ...state.edits, [key]: value };
    if (state.baseRevision !== void 0) return { ...state, edits };
    return { edits, baseRevision: snapshot.revision, baseAccepted: snapshot.value ?? null };
  }
  function reconcileStaged(state, snapshot) {
    if (state.baseRevision === void 0) return state;
    if (snapshot.status !== "ready" || snapshot.value === void 0 || snapshot.revision === void 0) return state;
    if (snapshot.revision === state.baseRevision) return state;
    if (!acceptedUnchanged(Object.keys(state.edits), state.baseAccepted, snapshot.value)) return state;
    return { ...state, baseRevision: snapshot.revision, baseAccepted: snapshot.value };
  }
  function settleSaved() {
    return { edits: {}, baseRevision: void 0, baseAccepted: null };
  }
  function settleFailed(state, snapshot) {
    return { ...state, baseRevision: snapshot.revision, baseAccepted: snapshot.value ?? null };
  }

  // src/client.ts
  var PACKAGE_NAME = "dsh-vision-tiler";
  var SETTINGS_ENTRY_ID = "vision-tiler";
  var LOCALE_NS = "visionTiler";
  var CSS = `
.vt-panel { display:flex; flex-direction:column; gap:10px; max-width:640px; font-size:13px; line-height:1.5; color:var(--dsw-alias-label-primary); }
.vt-note { margin:0; font-size:12px; line-height:1.5; color:var(--dsw-alias-label-secondary); }
.vt-row { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:10px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.vt-row:last-of-type { border-bottom:0; }
.vt-row-block { align-items:stretch; flex-direction:column; }
.vt-row-main { display:flex; flex-direction:column; gap:2px; min-width:0; }
.vt-label { font-weight:500; }
.vt-hint { margin:0; font-size:12px; line-height:1.5; color:var(--dsw-alias-label-secondary); }
.vt-number { width:112px; flex:none; padding:5px 8px; font:inherit; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:6px; }
.vt-select { min-width:132px; flex:none; padding:5px 8px; font:inherit; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:6px; }
.vt-number:focus-visible, .vt-select:focus-visible, .vt-textarea:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
.vt-textarea { width:100%; margin-top:6px; padding:6px 8px; font-size:12px; line-height:1.5; font-family:Consolas,var(--ds-font-family-code, "SF Mono", "JetBrains Mono", "Fira Code", "Liberation Mono", Menlo, monospace); color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:6px; resize:vertical; }
.vt-check { width:16px; height:16px; margin:0; accent-color:var(--dsw-alias-brand-primary); flex:none; }
.vt-error { margin:0; font-size:12px; line-height:1.5; color:var(--dsw-alias-state-error-primary); }
.vt-footer { display:flex; align-items:center; gap:10px; padding-top:4px; }
.vt-save { appearance:none; border:1px solid transparent; border-radius:6px; padding:5px 14px; font:inherit; font-size:13px; line-height:1.5; cursor:pointer; background:var(--dsw-alias-label-primary); color:var(--dsw-alias-bg-base); }
.vt-save:disabled { opacity:0.4; cursor:default; }
.vt-save:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
`;
  function factory(require2) {
    const React = require2("react");
    const { createElement: h, useEffect, useState } = React;
    function SettingsPanel(props) {
      const form = props.configForm;
      const t = typeof props.t === "function" ? props.t : (key) => key;
      const [snapshot, setSnapshot] = useState(() => form.getSnapshot());
      const [staged, setStaged] = useState(EMPTY_STAGED);
      const [saving, setSaving] = useState(false);
      const [failed, setFailed] = useState(false);
      useEffect(() => {
        setSnapshot(form.getSnapshot());
        return form.subscribe(() => {
          setSnapshot(form.getSnapshot());
        });
      }, [form]);
      useEffect(() => {
        setStaged((current) => reconcileStaged(current, snapshot));
      }, [snapshot]);
      if (props.view !== "page") return null;
      const style = h("style", { dangerouslySetInnerHTML: { __html: CSS } });
      const panel = (children2) => h("div", { className: "vt-panel" }, style, ...children2);
      if (snapshot.status === "loading") {
        return panel([h("p", { className: "vt-note", role: "status" }, t("loading"))]);
      }
      if (snapshot.status !== "ready") {
        return panel([h("p", { className: "vt-note", role: "status" }, t("unavailable"))]);
      }
      const accepted = snapshot.value ?? {};
      const writable = snapshot.writable !== false;
      const disabled = !writable || saving;
      const parsed = editedOps(staged.edits);
      const dirty = Object.keys(staged.edits).length > 0;
      const blocked = disabled || parsed.invalid || !dirty;
      const edit = (key, value) => {
        setFailed(false);
        setStaged((current) => stageEdit(current, key, value, snapshot));
      };
      const fail = () => {
        const current = form.getSnapshot();
        setSaving(false);
        setFailed(true);
        setStaged((currentStaged) => settleFailed(currentStaged, current));
      };
      const save = () => {
        if (blocked) return;
        setSaving(true);
        setFailed(false);
        form.mutate(parsed.ops, staged.baseRevision).then((acceptedChange) => {
          if (acceptedChange === true) {
            setSaving(false);
            setStaged(settleSaved());
            return;
          }
          fail();
        }, fail);
      };
      const rows = FIELDS.map((spec) => {
        const value = isEdited(staged.edits, spec.key) ? staged.edits[spec.key] : displayValue(spec, accepted[spec.key]);
        const id = `vt-${spec.key}`;
        const main = h(
          "div",
          { className: "vt-row-main" },
          h("label", { className: "vt-label", htmlFor: id }, t(spec.key)),
          h("p", { className: "vt-hint" }, t(`${spec.key}Hint`))
        );
        if (spec.kind === "boolean") {
          return h(
            "div",
            { className: "vt-row", key: spec.key },
            main,
            h("input", {
              id,
              className: "vt-check",
              type: "checkbox",
              checked: value === true,
              disabled,
              onChange: (event) => {
                edit(spec.key, event.target.checked);
              }
            })
          );
        }
        if (spec.kind === "enum") {
          const options = (spec.options ?? []).map((option) => h(
            "option",
            { key: option, value: option },
            t(`strategy${option.charAt(0).toUpperCase()}${option.slice(1)}`)
          ));
          return h(
            "div",
            { className: "vt-row", key: spec.key },
            main,
            h("select", {
              id,
              className: "vt-select",
              value: String(value),
              disabled,
              onChange: (event) => {
                edit(spec.key, event.target.value);
              }
            }, ...options)
          );
        }
        if (spec.kind === "lines") {
          return h(
            "div",
            { className: "vt-row vt-row-block", key: spec.key },
            main,
            h("textarea", {
              id,
              className: "vt-textarea",
              rows: 4,
              spellCheck: false,
              value: String(value),
              disabled,
              onChange: (event) => {
                edit(spec.key, event.target.value);
              }
            })
          );
        }
        const invalid = isEdited(staged.edits, spec.key) && parseField(spec, staged.edits[spec.key]).kind === "invalid";
        return h(
          "div",
          { className: "vt-row", key: spec.key },
          main,
          h("input", {
            id,
            className: "vt-number",
            type: "number",
            step: spec.kind === "integer" ? 1 : 1e-3,
            min: spec.min,
            max: spec.max,
            value: String(value),
            disabled,
            "aria-invalid": invalid || void 0,
            onChange: (event) => {
              edit(spec.key, event.target.value);
            }
          })
        );
      });
      const children = [h("p", { className: "vt-note" }, t("intro")), ...rows];
      if (!writable) children.unshift(h("p", { className: "vt-note", role: "status" }, t("readOnly")));
      if (parsed.invalid) children.push(h("p", { className: "vt-error", role: "status" }, t("invalidNumber")));
      if (failed) children.push(h("p", { className: "vt-error", role: "status" }, t("saveFailed")));
      children.push(h(
        "div",
        { className: "vt-footer" },
        h("button", {
          type: "button",
          className: "vt-save",
          disabled: blocked,
          onClick: save
        }, saving ? t("saving") : t("save"))
      ));
      return panel(children);
    }
    return {
      inject: ["slots", "locale", "configForms"],
      apply(ctx) {
        const configForm = ctx.configForms.get(SETTINGS_ENTRY_ID);
        ctx.effect(() => ctx.locale.register(LOCALE_NS, DICTIONARIES), "vision-tiler: locale");
        ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
          name: "plugins.bundle.config",
          key: PACKAGE_NAME,
          locale: LOCALE_NS,
          inject: () => ({ configForm })
        }, SettingsPanel));
      }
    };
  }
  if (typeof window !== "undefined" && window.__ModuleLoader__ !== void 0) {
    window.__ModuleLoader__.load({ id: PACKAGE_NAME, factory });
  }
})();
