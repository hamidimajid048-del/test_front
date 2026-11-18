// Panel languages: English (the language the pages are written in) and Persian. Loaded in <head> right after theme.js,
// so the language and the text direction are set before the first paint.
//
// The viewer's choice is kept in localStorage, so it belongs to the device and browser; without one, the browser's
// preferred language decides. The Persian text lives in /locales/fa.json, a catalog keyed by the English text:
//   strings    exact texts ("Shared IPs")
//   templates  texts with values ("Logins of {0} ({1})"); a value that is itself a known text is translated too
//   blocks     help paragraphs with inline formatting, keyed by their HTML
// The page is translated as it is built: a MutationObserver translates every text, title, placeholder and aria-label
// that a script adds, so page scripts stay in English and nothing has to be marked. Values (logins, IPs, emails) are
// left alone because no catalog entry matches them; an element can opt out with translate="no".
//
// Debugging: localStorage "violation-panel-i18n-debug" = "1" lists the texts the catalog does not cover
// (i18nMissing() in the console).

const LANGUAGE_STORAGE_KEY = 'violation-panel-language';
const LANGUAGE_DEBUG_KEY = 'violation-panel-i18n-debug';
const LANGUAGE_CATALOG_TIMEOUT_MS = 4000;
const LANGUAGES = {
  en: { code: 'en', short: 'EN', name: 'English', dir: 'ltr', catalog: null },
  fa: { code: 'fa', short: 'FA', name: 'فارسی', dir: 'rtl', catalog: '/locales/fa.json' },
};
const DEFAULT_LANGUAGE = 'en';

const I18N_SKIP_SELECTOR = 'script, style, textarea, code.raw, [translate="no"], .copyable, .notranslate';
const I18N_ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt'];
const I18N_INLINE_TAGS = new Set(['STRONG', 'EM', 'B', 'I', 'CODE', 'BR', 'KBD', 'SMALL']);
const I18N_BLOCK_TAGS = new Set(['LI', 'P', 'DD', 'SPAN', 'SMALL', 'DIV', 'LABEL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const LATIN = /[A-Za-z]/;

const i18nState = {
  language: DEFAULT_LANGUAGE,
  catalog: null,
  loading: null,
  observer: null,
  debug: false,
  missing: new Set(),
  texts: new WeakMap(),
  attributes: new WeakMap(),
  blocks: new WeakMap(),
};

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storedLanguage() {
  const value = readStorage(LANGUAGE_STORAGE_KEY);
  return value && LANGUAGES[value] ? value : null;
}

function preferredLanguage() {
  const preferred = (navigator.languages ?? [navigator.language]).map(code => String(code).slice(0, 2).toLowerCase());
  return preferred.find(code => LANGUAGES[code]) ?? DEFAULT_LANGUAGE;
}

function currentLanguage() {
  return i18nState.language;
}

const normalizeText = text => String(text).replace(/\s+/g, ' ').trim();
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- catalog ----

function compileCatalog(data) {
  const strings = new Map(Object.entries(data.strings ?? {}).map(([source, target]) => [normalizeText(source), target]));
  const blocks = new Map(Object.entries(data.blocks ?? {}).filter(([, target]) => target).map(([source, target]) => [normalizeText(source), target]));
  const byPrefix = new Map();
  const bySuffix = new Map();
  const loose = [];
  for (const [source, target] of Object.entries(data.templates ?? {})) {
    if (!target) continue;
    const parts = normalizeText(source).split(/\{(\d+)\}/);
    const literals = parts.filter((_, index) => index % 2 === 0);
    const template = {
      pattern: new RegExp(`^${parts.map((part, index) => (index % 2 ? '(.+?)' : escapeRegExp(part))).join('')}$`, 's'),
      order: parts.filter((_, index) => index % 2 === 1).map(Number),
      target,
      weight: literals.join('').length,
    };
    const [prefix, suffix] = [literals[0], literals[literals.length - 1]];
    if (prefix.length >= 3) (byPrefix.get(prefix.slice(0, 3)) ?? byPrefix.set(prefix.slice(0, 3), []).get(prefix.slice(0, 3))).push(template);
    else if (suffix.length >= 3) (bySuffix.get(suffix.slice(-3)) ?? bySuffix.set(suffix.slice(-3), []).get(suffix.slice(-3))).push(template);
    else loose.push(template);
  }
  for (const list of [...byPrefix.values(), ...bySuffix.values(), loose]) list.sort((a, b) => b.weight - a.weight);
  return { strings, blocks, byPrefix, bySuffix, loose };
}

function fillTemplate(template, match, depth) {
  const values = [];
  template.order.forEach((placeholder, index) => {
    const value = match[index + 1];
    values[placeholder] = lookupText(value, depth + 1) ?? value;
  });
  return template.target.replace(/\{(\d+)\}/g, (_, placeholder) => values[Number(placeholder)] ?? '');
}

function lookupTemplate(text, depth) {
  const { byPrefix, bySuffix, loose } = i18nState.catalog;
  for (const list of [byPrefix.get(text.slice(0, 3)), bySuffix.get(text.slice(-3)), loose]) {
    for (const template of list ?? []) {
      const match = template.pattern.exec(text);
      if (match) return fillTemplate(template, match, depth);
    }
  }
  return undefined;
}

// The translation of a normalized text: a string, null when the catalog keeps it in English, undefined when unknown.
function lookupText(text, depth = 0) {
  const catalog = i18nState.catalog;
  if (!catalog || depth > 2 || !LATIN.test(text)) return undefined;
  if (catalog.strings.has(text)) return catalog.strings.get(text);
  const templated = lookupTemplate(text, depth);
  if (templated !== undefined) return templated;

  // Composed texts: "Label:", "Label (12)", "Label...".
  const composed = /^(.*\S)\s*:$/.exec(text) ?? /^(.*\S) \((\d[\d,.]*)\)$/.exec(text) ?? /^(.*\S)(\.\.\.|…)$/.exec(text);
  if (composed) {
    const head = lookupText(composed[1], depth + 1);
    if (head) return text.endsWith(':') ? `${head}:` : composed[2] && /^\d/.test(composed[2]) ? `${head} (${composed[2]})` : `${head}...`;
  }

  // A list of known texts joined by commas ("Mobile, Client, VPS").
  if (text.includes(', ')) {
    const parts = text.split(', ').map(part => lookupText(part, depth + 1) ?? (LATIN.test(part) ? undefined : part));
    if (parts.every(part => part !== undefined)) return parts.map((part, index) => part ?? text.split(', ')[index]).join('، ');
  }
  return undefined;
}

function reportMissing(text) {
  if (!i18nState.debug || i18nState.missing.has(text)) return;
  i18nState.missing.add(text);
  console.debug('[i18n] missing:', text);
}

// A text in the current language; texts the catalog does not know stay as they are.
function translateValue(source) {
  const core = normalizeText(source);
  if (!core) return null;
  const translated = lookupText(core);
  if (translated === undefined) reportMissing(core);
  if (!translated) return null;
  return `${/^\s/.test(source) ? ' ' : ''}${translated}${/\s$/.test(source) ? ' ' : ''}`;
}

// For text that never reaches the page (or must be measured before it does): t('Shared IPs').
function t(text) {
  if (i18nState.language === DEFAULT_LANGUAGE || !i18nState.catalog) return text;
  return translateValue(String(text)) ?? text;
}

// ---- page translation ----

function insideTranslatedBlock(element) {
  for (let current = element; current; current = current.parentElement) {
    const block = i18nState.blocks.get(current);
    if (block && current.innerHTML === block.shown) return true;
  }
  return false;
}

function translateTextNode(node) {
  const known = i18nState.texts.get(node);
  if (known && node.data === known.shown) return;
  const parent = node.parentElement;
  if (!parent || parent.closest(I18N_SKIP_SELECTOR) || insideTranslatedBlock(parent)) return;
  const translated = LATIN.test(node.data) ? translateValue(node.data) : null;
  if (!translated || translated === node.data) {
    i18nState.texts.delete(node);
    return;
  }
  i18nState.texts.set(node, { source: node.data, shown: translated });
  node.data = translated;
}

function translateAttributes(element) {
  for (const name of I18N_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (!value || !LATIN.test(value)) continue;
    const states = i18nState.attributes.get(element) ?? new Map();
    if (states.get(name)?.shown === value) continue;
    const translated = translateValue(value);
    if (!translated) continue;
    states.set(name, { source: value, shown: translated });
    i18nState.attributes.set(element, states);
    element.setAttribute(name, translated);
  }
}

// A help paragraph whose text is mixed with inline formatting is translated as a whole, so the Persian sentence can be
// ordered naturally around the bold and italic parts.
function translateBlock(element) {
  if (!I18N_BLOCK_TAGS.has(element.tagName) || element.children.length === 0) return false;
  if (![...element.children].every(child => I18N_INLINE_TAGS.has(child.tagName) && [...child.children].every(inner => I18N_INLINE_TAGS.has(inner.tagName)))) return false;
  const known = i18nState.blocks.get(element);
  if (known && element.innerHTML === known.shown) return true;
  const translated = i18nState.catalog?.blocks.get(normalizeText(element.innerHTML));
  if (!translated) return false;
  i18nState.blocks.set(element, { source: element.innerHTML, shown: translated });
  element.innerHTML = translated;
  i18nState.blocks.set(element, { source: i18nState.blocks.get(element).source, shown: element.innerHTML });
  return true;
}

function translateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE || root.closest(I18N_SKIP_SELECTOR)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      if (node.matches(I18N_SKIP_SELECTOR)) {
        if (node.tagName === 'TEXTAREA') translateAttributes(node);
        return NodeFilter.FILTER_REJECT;
      }
      translateAttributes(node);
      return translateBlock(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  if (!root.matches(I18N_SKIP_SELECTOR)) {
    translateAttributes(root);
    if (translateBlock(root)) return;
  }
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
  }
}

// Back to English: every text, attribute and block shows its source again.
function restoreTree(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = root; node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const known = i18nState.texts.get(node);
      if (known && node.data === known.shown) node.data = known.source;
      i18nState.texts.delete(node);
      continue;
    }
    const block = i18nState.blocks.get(node);
    if (block && node.innerHTML === block.shown) node.innerHTML = block.source;
    i18nState.blocks.delete(node);
    for (const [name, state] of i18nState.attributes.get(node) ?? []) {
      if (node.getAttribute(name) === state.shown) node.setAttribute(name, state.source);
    }
    i18nState.attributes.delete(node);
  }
}

function onMutations(records) {
  for (const record of records) {
    if (record.type === 'childList') {
      for (const node of record.addedNodes) translateTree(node);
      if (record.target.nodeType === Node.ELEMENT_NODE && I18N_BLOCK_TAGS.has(record.target.tagName) && !record.target.closest(I18N_SKIP_SELECTOR)) translateBlock(record.target);
    } else if (record.type === 'characterData') {
      translateTextNode(record.target);
    } else if (record.type === 'attributes' && record.target.nodeType === Node.ELEMENT_NODE
      && (record.target.tagName === 'TEXTAREA' || !record.target.closest(I18N_SKIP_SELECTOR))) {
      translateAttributes(record.target);
    }
  }
}

function startTranslating() {
  translateTree(document.documentElement);
  i18nState.observer ??= new MutationObserver(onMutations);
  i18nState.observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: I18N_ATTRIBUTES,
  });
}

function stopTranslating() {
  i18nState.observer?.disconnect();
  restoreTree(document.documentElement);
}

async function loadCatalog(language) {
  const url = LANGUAGES[language].catalog;
  if (!url) return null;
  const response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Language catalog ${url} answered ${response.status}`);
  return compileCatalog(await response.json());
}

function applyDirection(language) {
  const root = document.documentElement;
  root.lang = LANGUAGES[language].code;
  root.dir = LANGUAGES[language].dir;
}

// Shows the page (hidden while the catalog of a non-English language loads, so English never flashes).
function revealPage() {
  document.documentElement.classList.remove('i18n-loading');
}

async function activateLanguage(language) {
  i18nState.language = language;
  applyDirection(language);
  if (language === DEFAULT_LANGUAGE) {
    stopTranslating();
    i18nState.catalog = null;
    revealPage();
    return;
  }
  document.documentElement.classList.add('i18n-loading');
  const reveal = setTimeout(revealPage, LANGUAGE_CATALOG_TIMEOUT_MS);
  try {
    i18nState.catalog = await loadCatalog(language);
    if (i18nState.language !== language) return;
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    startTranslating();
  } catch (error) {
    console.warn('[i18n] The language catalog could not be loaded; the panel stays in English.', error?.message ?? error);
    i18nState.catalog = null;
  } finally {
    clearTimeout(reveal);
    revealPage();
  }
}

// Changes the language of this device and applies it to the open page at once.
async function setLanguage(language) {
  if (!LANGUAGES[language] || language === i18nState.language) return;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage may be unavailable (private mode); the language still applies to this page.
  }
  await activateLanguage(language);
  document.querySelectorAll('.language-switcher').forEach(updateLanguageSwitcher);
  document.dispatchEvent(new CustomEvent('panel-languagechange', { detail: { language } }));
}

// ---- switcher ----

const LANGUAGE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></svg>';

function updateLanguageSwitcher(switcher) {
  const language = LANGUAGES[i18nState.language];
  switcher.querySelector('.language-code').textContent = language.short;
  for (const item of switcher.querySelectorAll('[data-language]')) {
    const selected = item.dataset.language === language.code;
    item.setAttribute('aria-checked', String(selected));
    item.classList.toggle('active', selected);
  }
}

// A compact menu (globe + language code) that switches the language of this device.
function createLanguageSwitcher() {
  const switcher = document.createElement('div');
  switcher.className = 'language-switcher';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'language-button';
  button.title = 'Language';
  button.setAttribute('aria-label', 'Language');
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = LANGUAGE_ICON;
  const code = document.createElement('span');
  code.className = 'language-code';
  code.translate = false;
  button.append(code);

  const menu = document.createElement('div');
  menu.className = 'language-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('translate', 'no');
  menu.hidden = true;
  for (const language of Object.values(LANGUAGES)) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'language-item';
    item.dataset.language = language.code;
    item.lang = language.code;
    item.dir = language.dir;
    item.setAttribute('role', 'menuitemradio');
    item.textContent = language.name;
    item.addEventListener('click', () => {
      close();
      setLanguage(language.code);
    });
    menu.append(item);
  }

  const onOutside = event => { if (!switcher.contains(event.target)) close(); };
  const onKey = event => {
    if (event.key === 'Escape') {
      close();
      button.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const items = [...menu.querySelectorAll('.language-item')];
      const index = items.indexOf(document.activeElement);
      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
  };
  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function open() {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    (menu.querySelector('.language-item.active') ?? menu.querySelector('.language-item')).focus();
  }
  button.addEventListener('click', () => (menu.hidden ? open() : close()));

  switcher.append(button, menu);
  updateLanguageSwitcher(switcher);
  return switcher;
}

// The texts the catalog does not cover, seen on this page since it opened (with the debug flag on).
function i18nMissing() {
  return [...i18nState.missing].sort();
}

i18nState.debug = readStorage(LANGUAGE_DEBUG_KEY) === '1';
activateLanguage(storedLanguage() ?? preferredLanguage());
