// Light/dark theme. Loaded in <head> so the theme is applied before the first paint (no flash).
// The viewer's choice (light, dark or system) is kept in localStorage; "system" follows the operating system preference.

const THEME_STORAGE_KEY = 'violation-panel-theme';
const THEME_CHOICES = ['light', 'dark', 'system'];
const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function storedTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

// What the viewer chose: light, dark, or system when nothing is stored.
function themeChoice() {
  return storedTheme() ?? 'system';
}

// The theme that is shown: the choice, or the operating system preference for "system".
function currentTheme() {
  return storedTheme() ?? (systemDarkQuery.matches ? 'dark' : 'light');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('.theme-toggle').forEach(updateThemeToggle);
}

function setTheme(choice) {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage may be unavailable (private mode); the theme still applies for this page.
  }
  applyTheme(currentTheme());
}

// The icon shows the current choice; a click moves to the next one.
const THEME_ICONS = {
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1.5 12h3M19.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  system: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
};

function nextThemeChoice(choice) {
  return THEME_CHOICES[(THEME_CHOICES.indexOf(choice) + 1) % THEME_CHOICES.length];
}

function updateThemeToggle(button) {
  const choice = themeChoice();
  button.innerHTML = THEME_ICONS[choice];
  const label = `Theme: ${choice}. Switch to ${nextThemeChoice(choice)}`;
  button.title = label;
  button.setAttribute('aria-label', label);
}

// A button that cycles the theme between light, dark and system.
function createThemeToggle() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme-toggle';
  button.addEventListener('click', () => setTheme(nextThemeChoice(themeChoice())));
  updateThemeToggle(button);
  return button;
}

systemDarkQuery.addEventListener('change', () => {
  if (!storedTheme()) applyTheme(currentTheme());
});

applyTheme(currentTheme());
