import type { Theme } from './theme.js';
import { opencodeTheme } from './opencode.js';
import { themeByName } from './themes.js';

let _current: Theme = opencodeTheme;
let _currentName = 'opencode';

export function currentTheme(): Theme {
  return _current;
}

export function currentThemeName(): string {
  return _currentName;
}

export function setTheme(theme: Theme): void {
  _current = theme;
}

/** Switch by registry name. Returns true if the name was found. */
export function setThemeByName(name: string): boolean {
  const theme = themeByName(name);
  if (!theme) return false;
  _current = theme;
  _currentName = name;
  return true;
}
