/**
 * Vision tiler — browser half.
 *
 * The Plugins page renders a bundle's settings only from a browser half that
 * registers `plugins.bundle.config`. This module is bundled into one classic
 * script by esbuild; its only runtime module request is React from the browser
 * module table. User-facing copy stays in locale/en.json and locale/zh.json and
 * is bundled from client-locales.ts.
 *
 * The Host owns the values. This half stages per-field edits, fences each save
 * with the revision read before the first edit, and writes through
 * `ctx.configForms`. Every accepted value is validated by the Host before it
 * reaches the profile.
 */

import { DICTIONARIES, type Dictionaries } from './client-locales.js';
import {
  EMPTY_STAGED,
  FIELDS,
  displayValue,
  editedOps,
  isEdited,
  parseField,
  reconcileStaged,
  settleFailed,
  settleSaved,
  stageEdit,
  type EditValue,
  type FormSnapshot,
  type SettingsOp,
  type StagedForm,
} from './settings-form.js';

const PACKAGE_NAME = 'dsh-vision-tiler';
const SETTINGS_ENTRY_ID = 'vision-tiler';
const LOCALE_NS = 'visionTiler';

type Disposable = () => void;

interface ModuleLoader {
  load(registration: {
    id: string;
    factory: (require: (name: string) => unknown) => ClientPlugin;
  }): void;
}

interface ConfigSnapshot extends FormSnapshot {
  writable?: boolean;
}

interface ConfigForm {
  getSnapshot(): ConfigSnapshot;
  subscribe(listener: () => void): Disposable;
  mutate(ops: readonly SettingsOp[], expectedRevision?: number): Promise<boolean>;
}

interface SlotOptions {
  name: string;
  key: string;
  locale: string;
  inject: () => { configForm: ConfigForm };
}

interface ClientContext {
  slots: {
    inject(name: string, register: () => Disposable): Disposable;
    register(options: SlotOptions, component: (props: SettingsProps) => unknown): Disposable;
  };
  locale: {
    register(namespace: string, dictionaries: Dictionaries): Disposable;
  };
  configForms: {
    get(entryId: string): ConfigForm;
  };
  effect(execute: () => Disposable | void, label?: string): Disposable;
}

interface ClientPlugin {
  inject: string[];
  apply(ctx: ClientContext): void;
}

interface ChangeEvent<T> {
  target: T;
}

interface ReactModule {
  createElement(
    type: string | ((props: SettingsProps) => unknown),
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown;
  useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void];
  useEffect(effect: () => void | Disposable, deps?: readonly unknown[]): void;
}

interface SettingsProps {
  view: 'summary' | 'page';
  configForm: ConfigForm;
  t?: (key: string) => string;
}

declare global {
  interface Window {
    __ModuleLoader__?: ModuleLoader;
  }
}

const CSS = `
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

/**
 * Browser plugin factory registered with the client module loader.
 * @param require Client module table resolver.
 * @returns Client plugin.
 */
function factory(require: (name: string) => unknown): ClientPlugin {
  const React = require('react') as ReactModule;
  const { createElement: h, useEffect, useState } = React;

  /**
   * The bundle's settings form.
   * @param props Slot view, injected form, and locale translator.
   * @returns The form, or null for a non-page view.
   */
  function SettingsPanel(props: SettingsProps): unknown {
    const form = props.configForm;
    const t = typeof props.t === 'function' ? props.t : (key: string) => key;
    const [snapshot, setSnapshot] = useState<ConfigSnapshot>(() => form.getSnapshot());
    const [staged, setStaged] = useState<StagedForm>(EMPTY_STAGED);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      setSnapshot(form.getSnapshot());
      return form.subscribe(() => { setSnapshot(form.getSnapshot()); });
    }, [form]);

    useEffect(() => {
      setStaged((current) => reconcileStaged(current, snapshot));
    }, [snapshot]);

    if (props.view !== 'page') return null;

    const style = h('style', { dangerouslySetInnerHTML: { __html: CSS } });
    const panel = (children: unknown[]): unknown => h('div', { className: 'vt-panel' }, style, ...children);
    if (snapshot.status === 'loading') {
      return panel([h('p', { className: 'vt-note', role: 'status' }, t('loading'))]);
    }
    if (snapshot.status !== 'ready') {
      return panel([h('p', { className: 'vt-note', role: 'status' }, t('unavailable'))]);
    }

    const accepted = snapshot.value ?? {};
    const writable = snapshot.writable !== false;
    const disabled = !writable || saving;
    const parsed = editedOps(staged.edits);
    const dirty = Object.keys(staged.edits).length > 0;
    const blocked = disabled || parsed.invalid || !dirty;

    const edit = (key: string, value: EditValue): void => {
      setFailed(false);
      setStaged((current) => stageEdit(current, key, value, snapshot));
    };

    const fail = (): void => {
      const current = form.getSnapshot();
      setSaving(false);
      setFailed(true);
      setStaged((currentStaged) => settleFailed(currentStaged, current));
    };

    const save = (): void => {
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

    const rows = FIELDS.map((spec): unknown => {
      const value = isEdited(staged.edits, spec.key)
        ? staged.edits[spec.key]
        : displayValue(spec, accepted[spec.key]);
      const id = `vt-${spec.key}`;
      const main = h('div', { className: 'vt-row-main' },
        h('label', { className: 'vt-label', htmlFor: id }, t(spec.key)),
        h('p', { className: 'vt-hint' }, t(`${spec.key}Hint`)));
      if (spec.kind === 'boolean') {
        return h('div', { className: 'vt-row', key: spec.key }, main,
          h('input', {
            id,
            className: 'vt-check',
            type: 'checkbox',
            checked: value === true,
            disabled,
            onChange: (event: ChangeEvent<{ checked: boolean }>) => { edit(spec.key, event.target.checked); },
          }));
      }
      if (spec.kind === 'enum') {
        const options = (spec.options ?? []).map((option) => h('option', { key: option, value: option },
          t(`strategy${option.charAt(0).toUpperCase()}${option.slice(1)}`)));
        return h('div', { className: 'vt-row', key: spec.key }, main,
          h('select', {
            id,
            className: 'vt-select',
            value: String(value),
            disabled,
            onChange: (event: ChangeEvent<{ value: string }>) => { edit(spec.key, event.target.value); },
          }, ...options));
      }
      if (spec.kind === 'lines') {
        return h('div', { className: 'vt-row vt-row-block', key: spec.key }, main,
          h('textarea', {
            id,
            className: 'vt-textarea',
            rows: 4,
            spellCheck: false,
            value: String(value),
            disabled,
            onChange: (event: ChangeEvent<{ value: string }>) => { edit(spec.key, event.target.value); },
          }));
      }
      const invalid = isEdited(staged.edits, spec.key)
        && parseField(spec, staged.edits[spec.key]).kind === 'invalid';
      return h('div', { className: 'vt-row', key: spec.key }, main,
        h('input', {
          id,
          className: 'vt-number',
          type: 'number',
          step: spec.kind === 'integer' ? 1 : 0.001,
          min: spec.min,
          max: spec.max,
          value: String(value),
          disabled,
          'aria-invalid': invalid || undefined,
          onChange: (event: ChangeEvent<{ value: string }>) => { edit(spec.key, event.target.value); },
        }));
    });

    const children: unknown[] = [h('p', { className: 'vt-note' }, t('intro')), ...rows];
    if (!writable) children.unshift(h('p', { className: 'vt-note', role: 'status' }, t('readOnly')));
    if (parsed.invalid) children.push(h('p', { className: 'vt-error', role: 'status' }, t('invalidNumber')));
    if (failed) children.push(h('p', { className: 'vt-error', role: 'status' }, t('saveFailed')));
    children.push(h('div', { className: 'vt-footer' },
      h('button', {
        type: 'button',
        className: 'vt-save',
        disabled: blocked,
        onClick: save,
      }, saving ? t('saving') : t('save'))));
    return panel(children);
  }

  return {
    inject: ['slots', 'locale', 'configForms'],
    apply(ctx: ClientContext): void {
      const configForm = ctx.configForms.get(SETTINGS_ENTRY_ID);
      ctx.effect(() => ctx.locale.register(LOCALE_NS, DICTIONARIES), 'vision-tiler: locale');
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: PACKAGE_NAME,
        locale: LOCALE_NS,
        inject: () => ({ configForm }),
      }, SettingsPanel));
    },
  };
}

if (typeof window !== 'undefined' && window.__ModuleLoader__ !== undefined) {
  window.__ModuleLoader__.load({ id: PACKAGE_NAME, factory });
}
