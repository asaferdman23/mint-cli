package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/glamour/ansi"
	"github.com/charmbracelet/lipgloss"
	"github.com/asaferdman23/mint-cli/tui-go/theme"
)

type role int

const (
	roleUser role = iota
	roleAssistant
)

type message struct {
	role       role
	content    string
	model      string
	durationMs int
	cost       float64
	streaming  bool
}

// renderMessages flattens the transcript into a single string for the viewport.
// Cyan border = user messages, Orange border = assistant — matches Mint brand.
func renderMessages(msgs []message, streaming string, width int, md *glamour.TermRenderer) string {
	s := styles()
	t := theme.Current
	var b strings.Builder

	// Welcome banner when there are no messages yet.
	if len(msgs) == 0 {
		logo := lipgloss.NewStyle().Foreground(t.Primary).Bold(true).Render(logoASCII)
		hint := s.muted.Render("  agentic coding CLI  ·  ctrl+h for help")
		b.WriteString("\n")
		b.WriteString(logo + "\n")
		b.WriteString(hint + "\n")
		return b.String()
	}

	for i, m := range msgs {
		if i > 0 {
			b.WriteString("\n")
		}
		content := m.content
		if m.streaming {
			content = streaming
		}

		if m.role == roleUser {
			b.WriteString(s.userName.Render("You") + "\n")
			for _, line := range strings.Split(content, "\n") {
				b.WriteString(s.userBorder.Render(iconThick+" ") + s.bright.Render(line) + "\n")
			}
		} else {
			if strings.TrimSpace(content) == "" {
				continue
			}
			b.WriteString(s.assistantName.Render("Mint") + "\n")
			rendered := content
			if md != nil {
				if out, err := md.Render(content); err == nil {
					rendered = strings.TrimRight(out, "\n")
				}
			}
			for _, line := range strings.Split(rendered, "\n") {
				b.WriteString(s.assistantBorder.Render(iconThick+" ") + line + "\n")
			}
			// Footer: model · duration · cost
			var parts []string
			if m.model != "" {
				parts = append(parts, lipgloss.NewStyle().Foreground(t.Primary).Render(m.model))
			}
			if m.durationMs > 0 {
				parts = append(parts, s.muted.Render(fmtDuration(m.durationMs)))
			}
			if m.cost > 0 {
				parts = append(parts,
					lipgloss.NewStyle().Foreground(t.Success).Render(fmt.Sprintf("$%.4f", m.cost)))
			}
			if len(parts) > 0 {
				b.WriteString("  " + strings.Join(parts, s.muted.Render("  ·  ")) + "\n")
			}
		}
	}
	return b.String()
}

func fmtDuration(ms int) string {
	if ms < 1000 {
		return fmt.Sprintf("%dms", ms)
	}
	if ms < 60000 {
		return fmt.Sprintf("%.1fs", float64(ms)/1000)
	}
	return fmt.Sprintf("%dm%ds", ms/60000, (ms%60000)/1000)
}

// newMarkdownRenderer builds a Glamour renderer using the Mint brand palette.
func newMarkdownRenderer(width int) *glamour.TermRenderer {
	t := theme.Current
	cyan := string(t.Primary)
	orange := string(t.Secondary)
	green := string(t.Accent)
	textBright := string(t.TextEmphasized)
	textMuted := string(t.TextMuted)

	hr := "\n─────────────────────────────────────────\n"
	colSep := "│"
	rowSep := "─"
	ctrSep := "┼"
	m0 := uint(0)
	m1 := uint(1)

	styleConfig := ansi.StyleConfig{
		Document: ansi.StyleBlock{
			StylePrimitive: ansi.StylePrimitive{Color: &textBright},
			Margin:         &m0,
		},
		Paragraph: ansi.StyleBlock{
			StylePrimitive: ansi.StylePrimitive{Color: &textBright},
		},
		BlockQuote: ansi.StyleBlock{
			StylePrimitive: ansi.StylePrimitive{
				Color:  &textMuted,
				Italic: boolPtr(true),
				Prefix: "│ ",
			},
		},
		Heading: ansi.StyleBlock{
			StylePrimitive: ansi.StylePrimitive{Color: &cyan, Bold: boolPtr(true)},
		},
		H1: ansi.StyleBlock{
			StylePrimitive: ansi.StylePrimitive{Color: &cyan, Bold: boolPtr(true), Prefix: "# "},
		},
		H2: ansi.StyleBlock{
			StylePrimitive: ansi.StylePrimitive{Color: &cyan, Bold: boolPtr(true), Prefix: "## "},
		},
		H3: ansi.StyleBlock{
			StylePrimitive: ansi.StylePrimitive{Color: &orange, Bold: boolPtr(true), Prefix: "### "},
		},
		H4: ansi.StyleBlock{
			StylePrimitive: ansi.StylePrimitive{Color: &orange, Prefix: "#### "},
		},
		Text:    ansi.StylePrimitive{Color: &textBright},
		Strong:  ansi.StylePrimitive{Color: &cyan, Bold: boolPtr(true)},
		Emph:    ansi.StylePrimitive{Color: &orange, Italic: boolPtr(true)},
		Link:    ansi.StylePrimitive{Color: &cyan, Underline: boolPtr(true)},
		LinkText: ansi.StylePrimitive{Color: &cyan},
		HorizontalRule: ansi.StylePrimitive{
			Color:  &textMuted,
			Format: hr,
		},
		// Inline code: orange
		Code: ansi.StyleBlock{
			StylePrimitive: ansi.StylePrimitive{Color: &orange},
		},
		// Fenced code blocks: syntax-highlighted with brand colors
		CodeBlock: ansi.StyleCodeBlock{
			StyleBlock: ansi.StyleBlock{
				StylePrimitive: ansi.StylePrimitive{Color: &textBright},
				Margin:         &m1,
			},
			Chroma: &ansi.Chroma{
				Text:                ansi.StylePrimitive{Color: &textBright},
				Keyword:             ansi.StylePrimitive{Color: &cyan, Bold: boolPtr(true)},
				KeywordReserved:     ansi.StylePrimitive{Color: &cyan, Bold: boolPtr(true)},
				KeywordType:         ansi.StylePrimitive{Color: &cyan},
				NameBuiltin:         ansi.StylePrimitive{Color: &cyan},
				NameFunction:        ansi.StylePrimitive{Color: &orange},
				NameClass:           ansi.StylePrimitive{Color: &orange, Bold: boolPtr(true)},
				LiteralString:       ansi.StylePrimitive{Color: &green},
				LiteralStringEscape: ansi.StylePrimitive{Color: &cyan},
				LiteralNumber:       ansi.StylePrimitive{Color: &orange},
				Comment:             ansi.StylePrimitive{Color: &textMuted, Italic: boolPtr(true)},
				GenericDeleted:      ansi.StylePrimitive{Color: &textMuted},
				GenericInserted:     ansi.StylePrimitive{Color: &green},
			},
		},
		List: ansi.StyleList{
			StyleBlock: ansi.StyleBlock{
				StylePrimitive: ansi.StylePrimitive{Color: &textBright},
			},
			LevelIndent: 2,
		},
		Item:        ansi.StylePrimitive{Color: &textBright},
		Enumeration: ansi.StylePrimitive{Color: &textBright},
		Table: ansi.StyleTable{
			StyleBlock: ansi.StyleBlock{
				StylePrimitive: ansi.StylePrimitive{Color: &textBright},
			},
			CenterSeparator: &ctrSep,
			ColumnSeparator: &colSep,
			RowSeparator:    &rowSep,
		},
		DefinitionTerm:        ansi.StylePrimitive{Color: &cyan, Bold: boolPtr(true)},
		DefinitionDescription: ansi.StylePrimitive{Color: &textBright},
	}

	r, err := glamour.NewTermRenderer(
		glamour.WithStyles(styleConfig),
		glamour.WithWordWrap(width),
	)
	if err != nil {
		r, _ = glamour.NewTermRenderer(
			glamour.WithStandardStyle("dark"),
			glamour.WithWordWrap(width),
		)
	}
	return r
}

func boolPtr(b bool) *bool { return &b }

// statusBar renders the bottom 1-row bar with Mint brand styling.
func statusBar(model, mode string, tokens int, cost float64, width int) string {
	s := styles()
	t := theme.Current

	logo := lipgloss.NewStyle().Foreground(t.Primary).Bold(true).Render(iconLogo)
	help := s.statusHelp.Render(" mint  ctrl+h help")
	left := logo + help

	sep := s.statusSep.Render(" │ ")

	mid := ""
	if tokens > 0 || cost > 0 {
		var parts []string
		if tokens > 0 {
			parts = append(parts, "ctx "+fmtTokens(tokens))
		}
		if cost > 0 {
			parts = append(parts,
				lipgloss.NewStyle().Foreground(t.Success).Render(fmt.Sprintf("$%.4f", cost)))
		}
		mid = sep + s.muted.Render(strings.Join(parts, "  "))
	}

	modeStr := lipgloss.NewStyle().Foreground(modeColor(mode)).Bold(true).Render(mode)
	modelStr := lipgloss.NewStyle().Foreground(t.Primary).Render(model)
	right := sep + modeStr + sep + modelStr

	line := left + mid
	pad := width - lipgloss.Width(line) - lipgloss.Width(right)
	if pad < 1 {
		pad = 1
	}
	return line + strings.Repeat(" ", pad) + right
}

func fmtTokens(n int) string {
	switch {
	case n >= 1_000_000:
		return fmt.Sprintf("%.1fM", float64(n)/1_000_000)
	case n >= 1_000:
		return fmt.Sprintf("%.0fK", float64(n)/1_000)
	default:
		return fmt.Sprintf("%d", n)
	}
}
