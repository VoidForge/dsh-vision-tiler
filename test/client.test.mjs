import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import vm from 'node:vm';
import { FIELDS } from '../lib/settings-form.js';

const PACKAGE_URL = new URL('../package.json', import.meta.url);
const PATCH_URL = new URL('../cordis.patch.yml', import.meta.url);
const CLIENT_URL = new URL('../lib/client.js', import.meta.url);
const LOCALE_EN_URL = new URL('../locale/en.json', import.meta.url);
const LOCALE_ZH_URL = new URL('../locale/zh.json', import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function createModuleContext() {
  const registrations = [];
  const context = vm.createContext({
    window: {
      __ModuleLoader__: {
        load(registration) {
          registrations.push(registration);
        },
      },
    },
  });
  return { context, registrations };
}

async function runClientOnce() {
  const code = await readFile(CLIENT_URL, 'utf8');
  const { context, registrations } = createModuleContext();
  vm.runInContext(code, context, { filename: 'lib/client.js' });
  return { context, registrations };
}

async function mountClientPlugin() {
  const { registrations } = await runClientOnce();
  assert.equal(registrations.length, 1);
  const reactStub = {
    createElement() {},
    useState() {},
    useEffect() {},
  };
  let requestedModule;
  const plugin = registrations[0].factory((name) => {
    requestedModule = name;
    return reactStub;
  });
  assert.equal(requestedModule, 'react');

  const configForm = {
    getSnapshot: () => ({ status: 'ready', value: {}, revision: 1 }),
    subscribe: () => () => {},
    mutate: async () => true,
  };
  const calls = {
    configFormIds: [],
    localeRegistrations: [],
    slotInjections: [],
    registration: undefined,
  };
  const ctx = {
    configForms: {
      get(id) {
        calls.configFormIds.push(id);
        return configForm;
      },
    },
    locale: {
      register(namespace, dictionaries) {
        calls.localeRegistrations.push({ namespace, dictionaries });
        return () => {};
      },
    },
    slots: {
      inject(name, register) {
        calls.slotInjections.push(name);
        return register();
      },
      register(options, component) {
        calls.registration = { options, component };
        return () => {};
      },
    },
    effect(execute) {
      const dispose = execute();
      return typeof dispose === 'function' ? dispose : () => {};
    },
  };
  plugin.apply(ctx);
  return { plugin, configForm, calls };
}

test('package.json declares the web client, its export, files and esbuild build', async () => {
  const manifest = await readJson(PACKAGE_URL);

  assert.deepEqual(manifest.dsh.client, { platform: 'web' });
  assert.equal('inject' in manifest.dsh.client, false);
  assert.equal('immediately' in manifest.dsh.client, false);
  assert.equal(manifest.exports['./client'], './lib/client.js');
  assert.equal(manifest.files.includes('lib'), true);
  assert.equal(manifest.scripts.build.includes('esbuild'), true);
});

test('lib/client.js executes twice as a classic script and registers the factory each time', async () => {
  const code = await readFile(CLIENT_URL, 'utf8');
  const { context, registrations } = createModuleContext();

  vm.runInContext(code, context, { filename: 'lib/client.js' });
  vm.runInContext(code, context, { filename: 'lib/client.js' });

  assert.equal(registrations.length, 2);
  for (const registration of registrations) {
    assert.equal(registration.id, 'dsh-vision-tiler');
    assert.equal(typeof registration.factory, 'function');
  }
  assert.equal(context.module, undefined);
  assert.equal(context.exports, undefined);
  assert.equal(context.require, undefined);
});

test('the client factory injects the settings services and registers the form', async () => {
  const { plugin, configForm, calls } = await mountClientPlugin();

  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale', 'configForms']);
  assert.deepEqual(calls.configFormIds, ['vision-tiler']);
  assert.deepEqual(calls.slotInjections, ['plugins.bundle.config']);

  const { options, component } = calls.registration;
  assert.equal(typeof component, 'function');
  assert.equal(options.name, 'plugins.bundle.config');
  assert.equal(options.key, 'dsh-vision-tiler');
  assert.equal(options.locale, 'visionTiler');
  assert.equal(typeof options.inject, 'function');
  assert.equal(options.inject().configForm, configForm);

  assert.equal(calls.localeRegistrations.length, 1);
  const localeRegistration = calls.localeRegistrations[0];
  assert.equal(localeRegistration.namespace, 'visionTiler');
  assert.equal(typeof localeRegistration.dictionaries.en, 'object');
  assert.equal(typeof localeRegistration.dictionaries.zh, 'object');

  const english = await readJson(LOCALE_EN_URL);
  const chinese = await readJson(LOCALE_ZH_URL);
  assert.equal(localeRegistration.dictionaries.en.loading, english.settings.loading);
  assert.equal(localeRegistration.dictionaries.zh.loading, chinese.settings.loading);
  for (const key of ['save', 'invalidNumber', 'strategyAdaptive']) {
    assert.equal(typeof localeRegistration.dictionaries.en[key], 'string', 'en ' + key);
    assert.equal(typeof localeRegistration.dictionaries.zh[key], 'string', 'zh ' + key);
  }
});

test('the client entry id and slot key match the patch row and package name', async () => {
  const { calls } = await mountClientPlugin();
  const manifest = await readJson(PACKAGE_URL);
  const patch = await readFile(PATCH_URL, 'utf8');

  const row = patch.match(/^\s*-\s+id:\s*(\S+)\s*$/m);
  assert.ok(row, 'cordis.patch.yml declares a row id');
  assert.equal(row[1], 'vision-tiler');
  assert.deepEqual(calls.configFormIds, [row[1]]);

  assert.equal(calls.registration.options.key, manifest.name);
  assert.equal(calls.registration.options.key, 'dsh-vision-tiler');
});

test('lib/client.js is not older than the sources and locales it bundles', async () => {
  const artifact = await stat(CLIENT_URL);
  for (const relative of [
    '../src/client.ts',
    '../src/settings-form.ts',
    '../src/client-locales.ts',
    '../locale/en.json',
    '../locale/zh.json',
  ]) {
    const source = await stat(new URL(relative, import.meta.url));
    assert.ok(artifact.mtimeMs >= source.mtimeMs, relative + ' is newer than lib/client.js');
  }
});

test('locale settings dictionaries have equal keys and cover every form field', async () => {
  const english = await readJson(LOCALE_EN_URL);
  const chinese = await readJson(LOCALE_ZH_URL);

  assert.equal(typeof english.settings, 'object');
  assert.equal(typeof chinese.settings, 'object');
  assert.deepEqual(Object.keys(english.settings).sort(), Object.keys(chinese.settings).sort());

  for (const spec of FIELDS) {
    for (const key of [spec.key, spec.key + 'Hint']) {
      assert.equal(typeof english.settings[key], 'string', 'en ' + key);
      assert.equal(typeof chinese.settings[key], 'string', 'zh ' + key);
    }
  }

  for (const key of [
    'loading',
    'unavailable',
    'readOnly',
    'intro',
    'save',
    'saving',
    'saveFailed',
    'invalidNumber',
    'strategyAdaptive',
    'strategyUniform',
  ]) {
    assert.equal(typeof english.settings[key], 'string', 'en ' + key);
    assert.equal(typeof chinese.settings[key], 'string', 'zh ' + key);
  }
});

const MONOSPACE_GENERICS = new Set(['monospace', 'ui-monospace']);
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);

function extractInjectedCss(code) {
  const match = code.match(/(?:var|let|const)\s+CSS\s*=\s*`([^`]*)`/);
  assert.ok(match, 'lib/client.js declares the injected CSS as a template literal');
  return match[1];
}

function collectRules(css) {
  const rules = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({
      selectors: match[1].split(',').map((selector) => selector.trim()),
      body: match[2],
    });
  }
  return rules;
}

function collectDeclarations(body) {
  const declarations = [];
  for (const part of body.split(';')) {
    const separator = part.indexOf(':');
    if (separator === -1) continue;
    declarations.push({
      property: part.slice(0, separator).trim().toLowerCase(),
      value: part.slice(separator + 1).trim(),
    });
  }
  return declarations;
}

function splitFamilies(value) {
  const families = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== '') {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      families.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  families.push(value.slice(start).trim());
  return families.filter((family) => family !== '');
}

function familyName(family) {
  const trimmed = family.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

test('the injected CSS sets the .vt-textarea font from Consolas and never starts a font-family with a bare monospace generic', async () => {
  const code = await readFile(CLIENT_URL, 'utf8');
  const css = extractInjectedCss(code);

  const baseRule = collectRules(css).find((rule) => rule.selectors.includes('.vt-textarea'));
  assert.ok(baseRule, 'lib/client.js injects a base .vt-textarea rule');
  const declarations = collectDeclarations(baseRule.body);

  const fontFamily = declarations.find((declaration) => declaration.property === 'font-family');
  assert.ok(fontFamily, 'the base .vt-textarea rule declares font-family');
  const familyValue = fontFamily.value.replace(/\s+/g, ' ').trim();
  const families = splitFamilies(familyValue);
  assert.ok(families.length > 0, 'the base .vt-textarea font-family names at least one family');
  assert.equal(familyName(families[0]), 'Consolas', 'Consolas is the first font family');
  assert.ok(
    families.length > 1 && families[1].startsWith('var(--ds-font-family-code'),
    'var(--ds-font-family-code follows Consolas as the fallback',
  );

  const fontSize = declarations.find((declaration) => declaration.property === 'font-size');
  assert.ok(fontSize, 'the base .vt-textarea rule declares font-size');
  assert.equal(fontSize.value.replace(/\s+/g, ' '), '12px');
  const lineHeight = declarations.find((declaration) => declaration.property === 'line-height');
  assert.ok(lineHeight, 'the base .vt-textarea rule declares line-height');
  assert.equal(lineHeight.value.replace(/\s+/g, ' '), '1.5');
  assert.equal(
    declarations.some((declaration) => declaration.property === 'font'),
    false,
    'the base .vt-textarea rule does not use the font shorthand',
  );

  for (const rule of collectRules(css)) {
    const selector = rule.selectors.join(', ');
    for (const declaration of collectDeclarations(rule.body)) {
      if (declaration.property !== 'font-family') continue;
      const value = declaration.value.replace(/\s+/g, ' ').trim();
      const declaredFamilies = splitFamilies(value);
      const first = declaredFamilies.length > 0 ? familyName(declaredFamilies[0]).toLowerCase() : '';
      assert.equal(
        MONOSPACE_GENERICS.has(first),
        false,
        selector + ' starts its font-family with the bare generic ' + first,
      );

      const genericMatch = value.match(/(?<![\w-])(?:ui-)?monospace(?![\w-])/i);
      if (genericMatch === null) continue;
      const before = value.slice(0, genericMatch.index);
      const namedBefore = splitFamilies(before).some((family) => {
        const name = familyName(family).toLowerCase();
        return name !== '' && !GENERIC_FAMILIES.has(name) && !name.startsWith('var(');
      });
      assert.ok(
        value.includes('var(--ds-font-family-code') || namedBefore,
        selector + ' names ' + genericMatch[0] + ' without var(--ds-font-family-code or a named family before it',
      );
    }
  }
});
