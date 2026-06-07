import type { Theme } from './theme.js';
import { opencodeTheme } from './opencode.js';

/** Dracula — purple/pink dark theme. */
export const draculaTheme: Theme = {
  primary: '#bd93f9', secondary: '#8be9fd', accent: '#ff79c6',
  error: '#ff5555', warning: '#ffb86c', success: '#50fa7b', info: '#8be9fd',
  text: '#f8f8f2', textMuted: '#6272a4', textEmphasized: '#f1fa8c',
  borderNormal: '#44475a', borderFocused: '#bd93f9', borderDim: '#343746',
  syntaxKeyword: '#ff79c6', syntaxString: '#f1fa8c', syntaxComment: '#6272a4',
  syntaxNumber: '#bd93f9', syntaxFunction: '#50fa7b', syntaxType: '#8be9fd', syntaxOperator: '#ff79c6',
  markdownHeading: '#bd93f9', markdownCode: '#f1fa8c', markdownLink: '#8be9fd', markdownBlockquote: '#6272a4',
};

/** Catppuccin Mocha — pastel palette. */
export const catppuccinTheme: Theme = {
  primary: '#f9e2af', secondary: '#89b4fa', accent: '#cba6f7',
  error: '#f38ba8', warning: '#fab387', success: '#a6e3a1', info: '#89dceb',
  text: '#cdd6f4', textMuted: '#6c7086', textEmphasized: '#f5c2e7',
  borderNormal: '#45475a', borderFocused: '#f9e2af', borderDim: '#313244',
  syntaxKeyword: '#cba6f7', syntaxString: '#a6e3a1', syntaxComment: '#6c7086',
  syntaxNumber: '#fab387', syntaxFunction: '#89b4fa', syntaxType: '#f9e2af', syntaxOperator: '#89dceb',
  markdownHeading: '#f9e2af', markdownCode: '#a6e3a1', markdownLink: '#89b4fa', markdownBlockquote: '#6c7086',
};

/** Gruvbox — retro green/orange. */
export const gruvboxTheme: Theme = {
  primary: '#fe8019', secondary: '#83a598', accent: '#d3869b',
  error: '#fb4934', warning: '#fabd2f', success: '#b8bb26', info: '#8ec07c',
  text: '#ebdbb2', textMuted: '#928374', textEmphasized: '#fabd2f',
  borderNormal: '#504945', borderFocused: '#fe8019', borderDim: '#3c3836',
  syntaxKeyword: '#fb4934', syntaxString: '#b8bb26', syntaxComment: '#928374',
  syntaxNumber: '#d3869b', syntaxFunction: '#8ec07c', syntaxType: '#fabd2f', syntaxOperator: '#fe8019',
  markdownHeading: '#fe8019', markdownCode: '#b8bb26', markdownLink: '#83a598', markdownBlockquote: '#928374',
};

/** Tokyo Night — blue/purple night theme. */
export const tokyonightTheme: Theme = {
  primary: '#7aa2f7', secondary: '#bb9af7', accent: '#7dcfff',
  error: '#f7768e', warning: '#e0af68', success: '#9ece6a', info: '#7dcfff',
  text: '#c0caf5', textMuted: '#565f89', textEmphasized: '#e0af68',
  borderNormal: '#3b4261', borderFocused: '#7aa2f7', borderDim: '#292e42',
  syntaxKeyword: '#bb9af7', syntaxString: '#9ece6a', syntaxComment: '#565f89',
  syntaxNumber: '#ff9e64', syntaxFunction: '#7aa2f7', syntaxType: '#2ac3de', syntaxOperator: '#89ddff',
  markdownHeading: '#7aa2f7', markdownCode: '#9ece6a', markdownLink: '#7dcfff', markdownBlockquote: '#565f89',
};

export interface NamedTheme { name: string; theme: Theme; }

/** Registry — opencode always first (the default). */
export const THEMES: NamedTheme[] = [
  { name: 'opencode', theme: opencodeTheme },
  { name: 'tokyonight', theme: tokyonightTheme },
  { name: 'catppuccin', theme: catppuccinTheme },
  { name: 'dracula', theme: draculaTheme },
  { name: 'gruvbox', theme: gruvboxTheme },
];

export function themeByName(name: string): Theme | undefined {
  return THEMES.find((t) => t.name === name)?.theme;
}
