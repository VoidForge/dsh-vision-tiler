/**
 * Browser dictionaries for the vision tiler settings form.
 *
 * The text stays in locale/en.json and locale/zh.json; this module only selects
 * the settings section so the client bundle can carry both baseline languages.
 */
import en from '../locale/en.json' with { type: 'json' };
import zh from '../locale/zh.json' with { type: 'json' };

/** Language dictionaries registered with the client locale service. */
export type Dictionaries = Record<string, Record<string, string>>;

/** The baseline dictionaries embedded in the browser half. */
export const DICTIONARIES: Dictionaries = {
  en: en.settings,
  zh: zh.settings,
};
