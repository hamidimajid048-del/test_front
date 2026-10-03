// Light/dark theme. Loaded in <head> so the theme is applied before the first paint (no flash).
// The viewer's choice is kept in localStorage; without one the operating system preference is followed.

const THEME_STORAGE_KEY = 'violation-panel-theme';
const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function storedTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function currentTheme() {
  return storedTheme() ?? (systemDarkQuery.matches ? 'dark' : 'light');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('.theme-toggle').forEach(updateThemeToggle);
}

function setTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable (private mode); the theme still applies for this page.
  }
  applyTheme(theme);
}

const THEME_ICONS = {
  // Shown in light mode: switches to dark.
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  // Shown in dark mode: switches to light.
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1.5 12h3M19.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
};

function updateThemeToggle(button) {
  const dark = document.documentElement.dataset.theme === 'dark';
  button.innerHTML = dark ? THEME_ICONS.sun : THEME_ICONS.moon;
  const label = dark ? 'تم روشن' : 'تم تیره';
  button.title = label;
  button.setAttribute('aria-label', label);
}

// A button that switches between the light and dark theme.
function createThemeToggle() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme-toggle';
  button.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  updateThemeToggle(button);
  return button;
}

systemDarkQuery.addEventListener('change', () => {
  if (!storedTheme()) applyTheme(currentTheme());
});

applyTheme(currentTheme());
