package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"github.com/asaferdman23/mint-cli/tui-go/theme"
)

// listItem is one row in a ListDialog.
type listItem struct {
	label  string
	hint   string
	active bool
}

// listDialog renders a centered modal list (model picker, theme switcher).
func listDialog(title string, items []listItem, selected, width, height int, footer string) string {
	t := theme.Current
	maxVisible := 10

	// Window around the selection.
	start := selected - maxVisible/2
	if start < 0 {
		start = 0
	}
	end := start + maxVisible
	if end > len(items) {
		end = len(items)
		start = end - maxVisible
		if start < 0 {
			start = 0
		}
	}

	inner := 36
	var b strings.Builder
	b.WriteString(lipgloss.NewStyle().Foreground(t.Primary).Bold(true).Render(iconLogo+" "+title) + "\n")
	b.WriteString(lipgloss.NewStyle().Foreground(t.BorderNormal).Render(strings.Repeat(iconSep, inner)) + "\n")

	if start > 0 {
		b.WriteString(lipgloss.NewStyle().Foreground(t.TextMuted).Render(fmt.Sprintf("  ── %d above", start)) + "\n")
	}
	for i := start; i < end; i++ {
		it := items[i]
		sel := i == selected
		pointer := "  "
		label := lipgloss.NewStyle().Foreground(t.TextMuted).Render(it.label)
		if sel {
			pointer = lipgloss.NewStyle().Foreground(t.Primary).Render(iconArrow + " ")
			label = lipgloss.NewStyle().Foreground(t.Text).Bold(true).Render(it.label)
		}
		hint := ""
		if it.hint != "" {
			hint = lipgloss.NewStyle().Foreground(t.BorderNormal).Render("  " + it.hint)
		}
		active := ""
		if it.active {
			active = lipgloss.NewStyle().Foreground(t.Success).Render("  " + iconCheck + " active")
		}
		b.WriteString(pointer + label + hint + active + "\n")
	}
	if end < len(items) {
		b.WriteString(lipgloss.NewStyle().Foreground(t.TextMuted).Render(fmt.Sprintf("  ── %d below", len(items)-end)) + "\n")
	}

	b.WriteString(lipgloss.NewStyle().Foreground(t.BorderNormal).Render(strings.Repeat(iconSep, inner)) + "\n")
	b.WriteString(lipgloss.NewStyle().Foreground(t.TextMuted).Render(footer))

	box := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(t.BorderFocused).
		Padding(1, 2).
		Render(b.String())
	return lipgloss.Place(width, height, lipgloss.Center, lipgloss.Center, box)
}

// trackedFile is a file touched during the session (for the sidebar).
type trackedFile struct {
	path   string
	status string // "NEW" | "EDIT" | "READ" | "BASH"
}

// sidebar renders the right-hand files panel.
func sidebar(files []trackedFile, tokens int, cost float64, width, height int) string {
	t := theme.Current
	inner := width - 4
	if inner < 8 {
		inner = 8
	}

	var b strings.Builder
	b.WriteString(lipgloss.NewStyle().Foreground(t.Primary).Bold(true).Render("Files") + "\n")
	b.WriteString(lipgloss.NewStyle().Foreground(t.BorderNormal).Render(strings.Repeat(iconSep, inner)) + "\n")

	if len(files) == 0 {
		b.WriteString(lipgloss.NewStyle().Foreground(t.TextMuted).Render("No files touched") + "\n")
	} else {
		limit := height - 5
		if limit < 1 {
			limit = 1
		}
		for i, f := range files {
			if i >= limit {
				b.WriteString(lipgloss.NewStyle().Foreground(t.TextMuted).Render(fmt.Sprintf("  +%d more", len(files)-i)) + "\n")
				break
			}
			b.WriteString(fileGlyph(f.status) + " " + truncatePath(f.path, inner-2) + "\n")
		}
	}

	body := strings.TrimRight(b.String(), "\n")
	body += "\n" + lipgloss.NewStyle().Foreground(t.BorderNormal).Render(strings.Repeat(iconSep, inner))
	body += "\n" + lipgloss.NewStyle().Foreground(t.TextMuted).Render(fmt.Sprintf("%s tok · $%.4f", fmtTokens(tokens), cost))

	return lipgloss.NewStyle().
		Border(lipgloss.NormalBorder()).
		BorderForeground(t.BorderNormal).
		Padding(0, 1).
		Width(width - 2).
		Height(height - 2).
		Render(body)
}

func fileGlyph(status string) string {
	t := theme.Current
	switch status {
	case "NEW":
		return lipgloss.NewStyle().Foreground(t.Success).Render("A")
	case "EDIT":
		return lipgloss.NewStyle().Foreground(t.Warning).Render("M")
	case "BASH":
		return lipgloss.NewStyle().Foreground(t.Info).Render("$")
	default:
		return lipgloss.NewStyle().Foreground(t.TextMuted).Render("R")
	}
}

func truncatePath(p string, max int) string {
	if max < 4 {
		max = 4
	}
	if len(p) <= max {
		return p
	}
	return "…" + p[len(p)-(max-1):]
}

// fileCompletion renders the @-completion dropdown shown above the editor.
func fileCompletion(matches []string, selected, width int) string {
	if len(matches) == 0 {
		return ""
	}
	t := theme.Current
	maxVisible := 8
	start := selected - maxVisible/2
	if start < 0 {
		start = 0
	}
	end := start + maxVisible
	if end > len(matches) {
		end = len(matches)
		start = end - maxVisible
		if start < 0 {
			start = 0
		}
	}

	var b strings.Builder
	for i := start; i < end; i++ {
		sel := i == selected
		pointer := "  "
		label := lipgloss.NewStyle().Foreground(t.TextMuted).Render(matches[i])
		if sel {
			pointer = lipgloss.NewStyle().Foreground(t.Primary).Render(iconArrow + " ")
			label = lipgloss.NewStyle().Foreground(t.Text).Bold(true).Render(matches[i])
		}
		b.WriteString(pointer + label)
		if i < end-1 {
			b.WriteString("\n")
		}
	}
	if end < len(matches) {
		b.WriteString("\n" + lipgloss.NewStyle().Foreground(t.TextMuted).Render(fmt.Sprintf("  … %d more", len(matches)-end)))
	}

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(t.BorderNormal).
		Padding(0, 1).
		Width(width - 2).
		Render(b.String())
}

// filterFiles returns files containing the query (case-insensitive), capped.
func filterFiles(files []string, query string, limit int) []string {
	q := strings.ToLower(query)
	out := make([]string, 0, limit)
	for _, f := range files {
		if strings.Contains(strings.ToLower(f), q) {
			out = append(out, f)
			if len(out) >= limit {
				break
			}
		}
	}
	return out
}
