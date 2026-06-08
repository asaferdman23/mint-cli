package ui

import (
	"github.com/charmbracelet/lipgloss"
	"github.com/asaferdman23/mint-cli/tui-go/theme"
)

const (
	iconLogo    = "⌬"  // mint logo mark
	iconThick   = "┃"
	iconArrow   = "›"
	iconBullet  = "•"
	iconCheck   = "✓"
	iconError   = "✖"
	iconWarning = "⚠"
	iconSep     = "─"
)

// ASCII logo — block letters from the landing page, scaled for terminal.
const logoASCII = `  ██╗   ██╗██╗███╗   ██╗████████╗
  ███╗ ███║██║████╗  ██║╚══██╔══╝
  ██╔████╔╝██║██╔██╗ ██║   ██║
  ██║╚██╔╝ ██║██║╚██╗██║   ██║
  ██║  ╚╝  ██║██║ ╚████║   ██║
  ╚═╝      ╚═╝╚═╝  ╚═══╝   ╚═╝`

// styleSet rebuilds lipgloss styles from the active theme.
type styleSet struct {
	// message borders
	userBorder      lipgloss.Style // cyan  — user messages
	assistantBorder lipgloss.Style // orange — assistant messages
	userName        lipgloss.Style
	assistantName   lipgloss.Style
	muted           lipgloss.Style
	bright          lipgloss.Style
	// input / overlays
	editorBox     lipgloss.Style
	approvalBox   lipgloss.Style
	statusHelp    lipgloss.Style
	statusSep     lipgloss.Style
	mode          lipgloss.Style
	accentKeyword lipgloss.Style
}

func styles() styleSet {
	t := theme.Current
	return styleSet{
		// cyan border for user, orange for assistant — matches landing page terminal
		userBorder:      lipgloss.NewStyle().Foreground(t.Primary),
		assistantBorder: lipgloss.NewStyle().Foreground(t.Secondary),
		userName:        lipgloss.NewStyle().Foreground(t.Primary).Bold(true),
		assistantName:   lipgloss.NewStyle().Foreground(t.Secondary).Bold(true),
		muted:           lipgloss.NewStyle().Foreground(t.TextMuted),
		bright:          lipgloss.NewStyle().Foreground(t.TextEmphasized),
		editorBox: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(t.BorderFocused).
			Padding(0, 1),
		approvalBox: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(t.Warning).
			Padding(0, 1),
		statusHelp:    lipgloss.NewStyle().Foreground(t.TextMuted),
		statusSep:     lipgloss.NewStyle().Foreground(t.BorderDim),
		mode:          lipgloss.NewStyle().Bold(true),
		accentKeyword: lipgloss.NewStyle().Foreground(t.Primary),
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
	default: // auto
		return t.Success
	}
}
