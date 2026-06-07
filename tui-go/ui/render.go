package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/lipgloss"
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

// renderMessages flattens the transcript into a single string for the viewport,
// with opencode-style thick left borders (user=blue, assistant=orange).
func renderMessages(msgs []message, streaming string, width int, md *glamour.TermRenderer) string {
	s := styles()
	var b strings.Builder

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
				b.WriteString(s.userBorder.Render(iconThick+" ") + line + "\n")
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
			// Footer: model · time · cost
			var parts []string
			if m.model != "" {
				parts = append(parts, m.model)
			}
			if m.durationMs > 0 {
				parts = append(parts, fmtDuration(m.durationMs))
			}
			if m.cost > 0 {
				parts = append(parts, fmt.Sprintf("$%.4f", m.cost))
			}
			if len(parts) > 0 {
				b.WriteString(s.muted.Render("  "+strings.Join(parts, "  ·  ")) + "\n")
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

// newMarkdownRenderer builds a Glamour renderer themed to the active palette.
func newMarkdownRenderer(width int) *glamour.TermRenderer {
	r, err := glamour.NewTermRenderer(
		glamour.WithStandardStyle("dark"),
		glamour.WithWordWrap(width),
	)
	if err != nil {
		return nil
	}
	return r
}

// statusBar renders the bottom 1-row bar.
func statusBar(model, mode string, tokens int, cost float64, width int) string {
	s := styles()
	left := s.statusHelp.Render("ctrl+h help")
	sep := s.statusSep.Render(" │ ")

	mid := ""
	if tokens > 0 || cost > 0 {
		seg := ""
		if tokens > 0 {
			seg += fmt.Sprintf("Context: %s", fmtTokens(tokens))
		}
		if cost > 0 {
			if seg != "" {
				seg += "  "
			}
			seg += fmt.Sprintf("Cost: $%.4f", cost)
		}
		mid = sep + s.muted.Render(seg)
	}

	modeStr := lipgloss.NewStyle().Foreground(modeColor(mode)).Bold(true).Render(mode)
	modelStr := s.muted.Render(model)
	right := sep + modeStr + sep + modelStr

	line := left + mid
	pad := width - lipgloss.Width(line) - lipgloss.Width(right)
	if pad < 1 {
		pad = 1
	}
	return " " + line + strings.Repeat(" ", pad) + right
}

func fmtTokens(n int) string {
	switch {
	case n >= 1000000:
		return fmt.Sprintf("%.1fM", float64(n)/1000000)
	case n >= 1000:
		return fmt.Sprintf("%.0fK", float64(n)/1000)
	default:
		return fmt.Sprintf("%d", n)
	}
}
