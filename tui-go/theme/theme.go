package theme

import "github.com/charmbracelet/lipgloss"

// Theme holds the full opencode-style color palette.
type Theme struct {
	Primary   lipgloss.Color // orange/gold
	Secondary lipgloss.Color // blue
	Accent    lipgloss.Color // purple

	Error   lipgloss.Color
	Warning lipgloss.Color
	Success lipgloss.Color
	Info    lipgloss.Color

	Text           lipgloss.Color
	TextMuted      lipgloss.Color
	TextEmphasized lipgloss.Color

	Background lipgloss.Color

	BorderNormal  lipgloss.Color
	BorderFocused lipgloss.Color
	BorderDim     lipgloss.Color
}

// OpenCode is the default theme — exact hex values from the opencode dark palette.
var OpenCode = Theme{
	Primary:   lipgloss.Color("#fab283"),
	Secondary: lipgloss.Color("#5c9cf5"),
	Accent:    lipgloss.Color("#9d7cd8"),

	Error:   lipgloss.Color("#e06c75"),
	Warning: lipgloss.Color("#f5a742"),
	Success: lipgloss.Color("#7fd88f"),
	Info:    lipgloss.Color("#56b6c2"),

	Text:           lipgloss.Color("#e0e0e0"),
	TextMuted:      lipgloss.Color("#6a6a6a"),
	TextEmphasized: lipgloss.Color("#e5c07b"),

	Background: lipgloss.Color("#212121"),

	BorderNormal:  lipgloss.Color("#4b4c5c"),
	BorderFocused: lipgloss.Color("#fab283"),
	BorderDim:     lipgloss.Color("#3a3b47"),
}

// TokyoNight — blue/purple night theme.
var TokyoNight = Theme{
	Primary:   lipgloss.Color("#7aa2f7"),
	Secondary: lipgloss.Color("#bb9af7"),
	Accent:    lipgloss.Color("#7dcfff"),
	Error:     lipgloss.Color("#f7768e"),
	Warning:   lipgloss.Color("#e0af68"),
	Success:   lipgloss.Color("#9ece6a"),
	Info:      lipgloss.Color("#7dcfff"),
	Text:      lipgloss.Color("#c0caf5"),
	TextMuted: lipgloss.Color("#565f89"),
	TextEmphasized: lipgloss.Color("#e0af68"),
	Background:     lipgloss.Color("#1a1b26"),
	BorderNormal:   lipgloss.Color("#3b4261"),
	BorderFocused:  lipgloss.Color("#7aa2f7"),
	BorderDim:      lipgloss.Color("#292e42"),
}

// Current is the active theme. Swapped at runtime by the theme switcher.
var Current = OpenCode

// Named lists the selectable themes in display order.
var Named = []struct {
	Name  string
	Theme Theme
}{
	{"opencode", OpenCode},
	{"tokyonight", TokyoNight},
}

// SetByName swaps the active theme. Returns false if the name is unknown.
func SetByName(name string) bool {
	for _, n := range Named {
		if n.Name == name {
			Current = n.Theme
			return true
		}
	}
	return false
}
