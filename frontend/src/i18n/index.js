import { ref, computed } from 'vue';
import { messages } from './messages';

const STORAGE_KEY = 'seraph-lang';
const SUPPORTED = ['zh', 'en'];
const DEFAULT_LOCALE = 'zh';

function readSaved() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED.includes(value) ? value : null;
  } catch (e) {
    return null;
  }
}

// Module-level reactive locale, shared across all components.
const locale = ref(readSaved() || DEFAULT_LOCALE);

function applyHtmlLang(value) {
  try {
    document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en';
  } catch (e) {
    /* noop */
  }
}
applyHtmlLang(locale.value);

export function setLocale(value) {
  if (!SUPPORTED.includes(value) || value === locale.value) return;
  locale.value = value;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch (e) {
    /* noop */
  }
  applyHtmlLang(value);
}

export function toggleLocale() {
  setLocale(locale.value === 'zh' ? 'en' : 'zh');
}

// Reads locale.value so callers in templates re-render on switch.
export function t(key, params) {
  const lang = locale.value;
  const table = messages[lang] || {};
  let str = Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : (messages[DEFAULT_LOCALE] && messages[DEFAULT_LOCALE][key]) || key;
  if (params && typeof params === 'object') {
    str = str.replace(/\{(\w+)\}/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? params[name] : m,
    );
  }
  return str;
}

export function useI18n() {
  return {
    locale,
    t,
    setLocale,
    toggleLocale,
    nextLabel: computed(() => (locale.value === 'zh' ? 'EN' : '中文')),
  };
}
