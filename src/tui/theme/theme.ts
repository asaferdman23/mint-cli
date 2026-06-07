export interface Theme {
  // Core palette
  primary: string;
  secondary: string;
  accent: string;
  // Status
  error: string;
  warning: string;
  success: string;
  info: string;
  // Text
  text: string;
  textMuted: string;
  textEmphasized: string;
  // Borders
  borderNormal: string;
  borderFocused: string;
  borderDim: string;
  // Syntax highlighting
  syntaxKeyword: string;
  syntaxString: string;
  syntaxComment: string;
  syntaxNumber: string;
  syntaxFunction: string;
  syntaxType: string;
  syntaxOperator: string;
  // Markdown
  markdownHeading: string;
  markdownCode: string;
  markdownLink: string;
  markdownBlockquote: string;
}
