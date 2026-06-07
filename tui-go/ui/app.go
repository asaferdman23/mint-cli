package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/lipgloss"

	"github.com/asaferdman23/mint-cli/tui-go/protocol"
	"github.com/asaferdman23/mint-cli/tui-go/theme"
)

// ── Messages ──────────────────────────────────────────────────────────────

// eventMsg carries one AgentEvent from the bridge into the tea loop.
type eventMsg struct {
	ev  protocol.Event
	err error
}

// Model is the root BubbleTea model.
type Model struct {
	bridge *protocol.Bridge

	width, height int
	ready         bool

	viewport viewport.Model
	editor   textarea.Model
	md       *glamour.TermRenderer

	messages   []message
	streaming  string
	busy       bool
	mode       string
	model      string
	tokens     int
	cost       float64
	statusErr  string
	activity   string

	// pending approval reason (empty = none)
	approval string

	overlay string // "" | "help"
}

// New builds the initial model.
func New(bridge *protocol.Bridge, mode string) Model {
	ta := textarea.New()
	ta.Placeholder = "Ask anything…  / for commands"
	ta.Prompt = ""
	ta.ShowLineNumbers = false
	ta.SetHeight(1)
	ta.Focus()
	ta.CharLimit = 0

	return Model{
		bridge: bridge,
		editor: ta,
		mode:   mode,
		model:  "auto",
	}
}

// Init kicks off the event reader.
func (m Model) Init() tea.Cmd {
	return tea.Batch(textarea.Blink, m.readEvent)
}

// readEvent blocks on the next bridge event, in a goroutine-friendly tea.Cmd.
func (m Model) readEvent() tea.Msg {
	ev, err := m.bridge.Next()
	return eventMsg{ev: ev, err: err}
}

// ── Update ────────────────────────────────────────────────────────────────

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {

	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.layout()
		m.md = newMarkdownRenderer(m.contentWidth())
		m.refreshViewport()
		m.ready = true
		return m, nil

	case tea.KeyMsg:
		return m.handleKey(msg)

	case eventMsg:
		if msg.err != nil {
			// Stream closed — keep UI alive, mark idle.
			m.busy = false
			return m, nil
		}
		m.applyEvent(msg.ev)
		return m, m.readEvent // re-arm
	}

	// Forward to editor when idle.
	if !m.busy && m.overlay == "" {
		var cmd tea.Cmd
		m.editor, cmd = m.editor.Update(msg)
		return m, cmd
	}
	return m, nil
}

func (m Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c":
		return m, tea.Quit
	case "ctrl+h":
		if m.overlay == "help" {
			m.overlay = ""
		} else {
			m.overlay = "help"
		}
		return m, nil
	}

	if m.overlay != "" {
		m.overlay = ""
		return m, nil
	}

	// Approval gate.
	if m.approval != "" {
		switch msg.String() {
		case "y", "enter":
			m.bridge.Send(protocol.Command{Type: "approval", OK: true})
			m.approval = ""
		case "n":
			m.bridge.Send(protocol.Command{Type: "approval", OK: false})
			m.approval = ""
		}
		return m, nil
	}

	switch msg.String() {
	case "enter":
		val := strings.TrimSpace(m.editor.Value())
		if val == "" || m.busy {
			return m, nil
		}
		return m, m.submit(val)
	case "pgup":
		m.viewport.HalfViewUp()
		return m, nil
	case "pgdown":
		m.viewport.HalfViewDown()
		return m, nil
	}

	if !m.busy {
		var cmd tea.Cmd
		m.editor, cmd = m.editor.Update(msg)
		return m, cmd
	}
	return m, nil
}

func (m *Model) submit(val string) tea.Cmd {
	// Local slash commands handled inline.
	switch {
	case val == "/clear":
		m.messages = nil
		m.streaming = ""
		m.refreshViewport()
		m.editor.Reset()
		return nil
	case val == "/diff", val == "/auto", val == "/plan", val == "/yolo":
		m.mode = strings.TrimPrefix(val, "/")
		m.editor.Reset()
		return nil
	}

	m.messages = append(m.messages, message{role: roleUser, content: val})
	m.messages = append(m.messages, message{role: roleAssistant, streaming: true})
	m.streaming = ""
	m.busy = true
	m.editor.Reset()
	m.refreshViewport()

	cmd := protocol.Command{Type: "prompt", Task: val, Mode: m.mode}
	if m.model != "auto" {
		cmd.Model = m.model
	}
	m.bridge.Send(cmd)
	return nil
}

func (m *Model) applyEvent(ev protocol.Event) {
	switch ev.Type {
	case "classify":
		m.model = ev.Model
		m.activity = fmt.Sprintf("Routed to %s (%s · %s)", ev.Model, ev.Kind, ev.Complexity)
	case "context.retrieved":
		m.activity = fmt.Sprintf("Read %d files for context", len(ev.Files))
	case "tool.call":
		m.activity = describeTool(ev.Name, ev.Input)
	case "text.delta":
		m.streaming += ev.Text
		m.refreshViewport()
	case "cost.delta":
		m.cost += ev.Usd
		m.tokens += ev.InputTokens + ev.OutputTokens
	case "approval.needed":
		m.approval = ev.Reason
	case "warn":
		m.statusErr = ev.Message
	case "error":
		m.statusErr = ev.Error
	case "done":
		m.busy = false
		m.activity = ""
		if ev.Result != nil && len(m.messages) > 0 {
			last := &m.messages[len(m.messages)-1]
			last.streaming = false
			last.content = ev.Result.Output
			if last.content == "" {
				last.content = "(no output)"
			}
			last.model = ev.Result.Model
			last.durationMs = ev.Result.DurationMs
			last.cost = ev.Result.TotalCostUsd
		}
		m.streaming = ""
		m.refreshViewport()
	}
}

func describeTool(name string, input map[string]interface{}) string {
	verbs := map[string]string{
		"read_file": "Reading", "write_file": "Writing", "edit_file": "Editing",
		"search_replace": "Editing", "bash": "Running command", "grep": "Searching",
		"glob": "Listing files", "list_dir": "Listing files", "run_tests": "Running tests",
	}
	v := verbs[name]
	if v == "" {
		v = "Calling " + name
	}
	if input != nil {
		for _, k := range []string{"path", "file", "command", "pattern", "query"} {
			if val, ok := input[k].(string); ok {
				return v + " " + val
			}
		}
	}
	return v + "…"
}

// ── View ──────────────────────────────────────────────────────────────────

func (m Model) View() string {
	if !m.ready {
		return "starting…"
	}

	if m.overlay == "help" {
		return m.helpView()
	}

	var b strings.Builder
	b.WriteString(m.viewport.View())
	b.WriteString("\n")
	b.WriteString(m.inputView())
	b.WriteString("\n")
	b.WriteString(statusBar(m.model, m.mode, m.tokens, m.cost, m.width))
	return b.String()
}

func (m Model) inputView() string {
	s := styles()
	if m.busy {
		label := m.activity
		if label == "" {
			label = "Thinking…"
		}
		box := s.editorBox.Width(m.width - 2).Render(
			lipgloss.NewStyle().Foreground(theme.Current.Primary).Render("◐ ") + label,
		)
		return box
	}
	if m.approval != "" {
		return s.editorBox.Width(m.width-2).BorderForeground(theme.Current.Warning).Render(
			lipgloss.NewStyle().Foreground(theme.Current.Warning).Render(
				fmt.Sprintf("Approve %s? [y/Enter] yes  [n] no", m.approval),
			),
		)
	}
	return s.editorBox.Width(m.width - 2).Render(m.editor.View())
}

func (m Model) helpView() string {
	t := theme.Current
	lines := []string{
		iconLogo + " Mint CLI — Help",
		strings.Repeat(iconSep, 40),
		"/clear              clear chat",
		"/diff /auto /plan /yolo   set mode",
		"",
		"ctrl+h   toggle help",
		"ctrl+c   exit",
		"pgup/pgdn  scroll",
		"",
		"Press any key to close",
	}
	body := lipgloss.NewStyle().Foreground(t.TextMuted).Render(strings.Join(lines, "\n"))
	box := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(t.BorderFocused).
		Padding(1, 2).
		Render(body)
	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, box)
}

// ── Layout helpers ─────────────────────────────────────────────────────────

func (m *Model) layout() {
	vpHeight := m.height - m.inputHeight() - 1 // status bar
	if vpHeight < 1 {
		vpHeight = 1
	}
	if m.viewport.Width == 0 {
		m.viewport = viewport.New(m.width, vpHeight)
	} else {
		m.viewport.Width = m.width
		m.viewport.Height = vpHeight
	}
	m.editor.SetWidth(m.width - 4)
}

func (m Model) inputHeight() int { return 3 }

func (m Model) contentWidth() int {
	w := m.width - 4
	if w < 20 {
		return 20
	}
	return w
}

func (m *Model) refreshViewport() {
	if m.width == 0 {
		return
	}
	content := renderMessages(m.messages, m.streaming, m.contentWidth(), m.md)
	m.viewport.SetContent(content)
	m.viewport.GotoBottom()
}
