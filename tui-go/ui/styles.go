package ui

import (
	"github.com/charmbracelet/lipgloss"
	"github.com/asaferdman23/mint-cli/tui-go/theme"
)

const (
	iconLogo    = "⌬"
	iconThick   = "┃"
	iconArrow   = "›"
	iconBullet  = "•"
	iconCheck   = "✓"
	iconError   = "✖"
	iconWarning = "⚠"
	iconSep     = "─"
)

// styleSet rebuilds lipgloss styles from the active theme (call after theme swap).
type styleSet struct {
	userBorder      lipgloss.Style
	assistantBorder lipgloss.Style
	userName        lipgloss.Style
	assistantName   lipgloss.Style
	muted           lipgloss.Style
	editorBox       lipgloss.Style
	statusHelp      lipgloss.Style
	statusSep       lipgloss.Style
	mode            lipgloss.Style
}

func styles() styleSet {
	t := theme.Current
	return styleSet{
		userBorder:      lipgloss.NewStyle().Foreground(t.Secondary),
		assistantBorder: lipgloss.NewStyle().Foreground(t.Primary),
		userName:        lipgloss.NewStyle().Foreground(t.Secondary).Bold(true),
		assistantName:   lipgloss.NewStyle().Foreground(t.Primary).Bold(true),
		muted:           lipgloss.NewStyle().Foreground(t.TextMuted),
		editorBox: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(t.BorderFocused).
			Padding(0, 1),
		statusHelp: lipgloss.NewStyle().Foreground(t.TextMuted),
		statusSep:  lipgloss.NewStyle().Foreground(t.BorderNormal),
		mode:       lipgloss.NewStyle().Bold(true),
	}
}

func modeColor(mode string) lipgloss.Color {
	t := theme.Current
	switch mode {
	case "yolo":
		return t.Error
	case "plan":
		return t.Info
	case "diff":
		return t.Warning
	default:
		return t.Success
	}
}
