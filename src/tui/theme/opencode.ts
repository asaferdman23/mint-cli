import type { Theme } from './theme.js';

export const opencodeTheme: Theme = {
  // Core — exact opencode hex values
  primary: '#fab283',       // orange/gold
  secondary: '#5c9cf5',     // blue
  accent: '#9d7cd8',        // purple

  // Status
  error: '#e06c75',
  warning: '#f5a742',
  success: '#7fd88f',
  info: '#56b6c2',

  // Text
  text: '#e0e0e0',
  textMuted: '#6a6a6a',
  textEmphasized: '#e5c07b',

  // Borders
  borderNormal: '#4b4c5c',
  borderFocused: '#fab283',  // = primary
  borderDim: '#3a3b47',

  // Syntax
  syntaxKeyword: '#c678dd',
  syntaxString: '#98c379',
  syntaxComment: '#5c6370',
  syntaxNumber: '#d19a66',
  syntaxFunction: '#61afef',
  syntaxType: '#e5c07b',
  syntaxOperator: '#56b6c2',

  // Markdown
  markdownHeading: '#fab283',
  markdownCode: '#98c379',
  markdownLink: '#5c9cf5',
  markdownBlockquote: '#6a6a6a',
};
