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

// eventMsg carries one AgentEvent from the bridge into the tea loop.
type eventMsg struct {
	ev  protocol.Event
	err error
}

const fileCompletionLimit = 50

// Model is the root BubbleTea model.
type Model struct {
	bridge *protocol.Bridge

	width, height int
	ready         bool

	viewport viewport.Model
	editor   textarea.Model
	md       *glamour.TermRenderer

	messages  []message
	streaming string
	busy      bool
	mode      string
	model     string
	tokens    int
	cost      float64
	statusErr string
	activity  string

	approval string // pending approval reason ("" = none)

	// Overlay state machine: "" | "help" | "model" | "theme"
	overlay      string
	overlayIndex int
	showSidebar  bool
	themeName    string

	// Picker data (from the meta event).
	models    []protocol.ModelInfo
	filePaths []string
	files     []trackedFile // touched this session (sidebar)

	// @-completion state.
	fileIndex int
}

// New builds the initial model.
func New(bridge *protocol.Bridge, mode, themeName string) Model {
	ta := textarea.New()
	ta.Placeholder = "Ask anything…  / commands · @ files"
	ta.Prompt = ""
	ta.ShowLineNumbers = false
	ta.SetHeight(1)
	ta.Focus()
	ta.CharLimit = 0

	return Model{
		bridge:    bridge,
		editor:    ta,
		mode:      mode,
		model:     "auto",
		themeName: themeName,
	}
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(textarea.Blink, m.readEvent)
}

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
			m.busy = false
			return m, nil
		}
		m.applyEvent(msg.ev)
		return m, m.readEvent
	}

	if !m.busy && m.overlay == "" {
		var cmd tea.Cmd
		m.editor, cmd = m.editor.Update(msg)
		return m, cmd
	}
	return m, nil
}

func (m Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	key := msg.String()

	// Global.
	switch key {
	case "ctrl+c":
		return m, tea.Quit
	case "ctrl+h":
		m.toggleOverlay("help")
		return m, nil
	}

	// Overlay-active: capture nav, swallow the rest.
	if m.overlay != "" {
		return m.handleOverlayKey(msg)
	}

	// Approval gate.
	if m.approval != "" {
		switch key {
		case "y", "enter":
			m.bridge.Send(protocol.Command{Type: "approval", OK: true})
			m.approval = ""
		case "n":
			m.bridge.Send(protocol.Command{Type: "approval", OK: false})
			m.approval = ""
		}
		return m, nil
	}

	// Open-overlay + sidebar shortcuts.
	switch key {
	case "ctrl+o":
		m.openPicker("model")
		return m, nil
	case "ctrl+t":
		m.openPicker("theme")
		return m, nil
	case "ctrl+b":
		m.showSidebar = !m.showSidebar
		m.layout()
		m.refreshViewport()
		return m, nil
	}

	// @-completion navigation takes priority over the editor.
	if q, ok := m.activeAtQuery(); ok {
		matches := filterFiles(m.filePaths, q, fileCompletionLimit)
		if len(matches) > 0 {
			switch key {
			case "up":
				if m.fileIndex > 0 {
					m.fileIndex--
				}
				return m, nil
			case "down":
				if m.fileIndex < len(matches)-1 {
					m.fileIndex++
				}
				return m, nil
			case "tab", "enter":
				m.applyFileCompletion(matches[m.fileIndex%len(matches)])
				return m, nil
			}
		}
	}

	switch key {
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
		m.fileIndex = 0 // reset selection as the query changes
		return m, cmd
	}
	return m, nil
}

func (m Model) handleOverlayKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	key := msg.String()
	if key == "esc" {
		// Revert a live theme preview.
		if m.overlay == "theme" && theme.Current != themeFor(m.themeName) {
			theme.SetByName(m.themeName)
			m.rebuildTheme()
		}
		m.overlay = ""
		return m, nil
	}
	if m.overlay == "help" {
		m.overlay = ""
		return m, nil
	}

	n := m.overlayLen()
	if n == 0 {
		return m, nil
	}
	switch key {
	case "up":
		m.overlayIndex = (m.overlayIndex - 1 + n) % n
	case "down":
		m.overlayIndex = (m.overlayIndex + 1) % n
	case "enter":
		m.commitOverlay()
		m.overlay = ""
		return m, nil
	}
	// Live theme preview.
	if m.overlay == "theme" {
		theme.SetByName(theme.Named[m.overlayIndex].Name)
		m.rebuildTheme()
	}
	return m, nil
}

func (m *Model) overlayLen() int {
	switch m.overlay {
	case "model":
		return len(m.models)
	case "theme":
		return len(theme.Named)
	}
	return 0
}

func (m *Model) commitOverlay() {
	switch m.overlay {
	case "model":
		if m.overlayIndex < len(m.models) {
			m.model = m.models[m.overlayIndex].ID
		}
	case "theme":
		name := theme.Named[m.overlayIndex].Name
		theme.SetByName(name)
		m.themeName = name
		m.rebuildTheme()
	}
}

func (m *Model) openPicker(which string) {
	m.overlay = which
	switch which {
	case "model":
		m.overlayIndex = 0
		for i, mi := range m.models {
			if mi.ID == m.model {
				m.overlayIndex = i
				break
			}
		}
	case "theme":
		m.overlayIndex = 0
		for i, n := range theme.Named {
			if n.Name == m.themeName {
				m.overlayIndex = i
				break
			}
		}
	}
}

func (m *Model) toggleOverlay(which string) {
	if m.overlay == which {
		m.overlay = ""
	} else {
		m.overlay = which
	}
}

func (m *Model) rebuildTheme() {
	m.md = newMarkdownRenderer(m.contentWidth())
	m.refreshViewport()
}

// ── @-completion helpers ────────────────────────────────────────────────────

func (m Model) activeAtQuery() (string, bool) {
	val := m.editor.Value()
	at := strings.LastIndex(val, "@")
	if at < 0 {
		return "", false
	}
	if at > 0 && !isSpace(val[at-1]) {
		return "", false
	}
	token := val[at+1:]
	if strings.ContainsAny(token, " \t\n") {
		return "", false
	}
	return token, true
}

func (m *Model) applyFileCompletion(file string) {
	val := m.editor.Value()
	at := strings.LastIndex(val, "@")
	if at < 0 {
		return
	}
	m.editor.SetValue(val[:at] + "@" + file + " ")
	m.fileIndex = 0
}

func isSpace(b byte) bool { return b == ' ' || b == '\t' || b == '\n' }

// ── Submit + events ─────────────────────────────────────────────────────────

func (m *Model) submit(val string) tea.Cmd {
	switch {
	case val == "/clear":
		m.messages = nil
		m.streaming = ""
		m.files = nil
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
	case "meta":
		m.models = ev.Models
		m.filePaths = ev.Paths
	case "classify":
		m.model = ev.Model
		m.activity = fmt.Sprintf("Routed to %s (%s · %s)", ev.Model, ev.Kind, ev.Complexity)
	case "context.retrieved":
		m.activity = fmt.Sprintf("Read %d files for context", len(ev.Files))
	case "tool.call":
		m.activity = describeTool(ev.Name, ev.Input)
		m.trackToolFile(ev.Name, ev.Input)
	case "text.delta":
		m.streaming += ev.Text
		m.refreshViewport()
	case "diff.applied":
		m.markFile(ev.File, "EDIT")
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

func (m *Model) trackToolFile(name string, input map[string]interface{}) {
	status := map[string]string{
		"read_file": "READ", "write_file": "NEW", "edit_file": "EDIT",
		"search_replace": "EDIT", "bash": "BASH", "run_command": "BASH",
	}[name]
	if status == "" {
		return
	}
	path := ""
	for _, k := range []string{"path", "file", "command"} {
		if v, ok := input[k].(string); ok {
			path = v
			break
		}
	}
	if path != "" {
		m.markFile(path, status)
	}
}

func (m *Model) markFile(path, status string) {
	for i := range m.files {
		if m.files[i].path == path {
			m.files[i].status = status
			return
		}
	}
	m.files = append(m.files, trackedFile{path: path, status: status})
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

	switch m.overlay {
	case "help":
		return m.helpView()
	case "model":
		items := make([]listItem, len(m.models))
		for i, mi := range m.models {
			items[i] = listItem{label: mi.ID, hint: "[" + mi.Tier + "]", active: mi.ID == m.model}
		}
		return listDialog("Select model", items, m.overlayIndex, m.width, m.height, "↑/↓ navigate · Enter select · Esc cancel")
	case "theme":
		items := make([]listItem, len(theme.Named))
		for i, n := range theme.Named {
			items[i] = listItem{label: n.Name, active: n.Name == m.themeName}
		}
		return listDialog("Select theme", items, m.overlayIndex, m.width, m.height, "↑/↓ preview · Enter apply · Esc cancel")
	}

	var b strings.Builder

	// Messages (+ optional sidebar).
	if m.sidebarVisible() {
		sb := sidebar(m.files, m.tokens, m.cost, m.sidebarWidth(), m.viewport.Height)
		row := lipgloss.JoinHorizontal(lipgloss.Top, m.viewport.View(), sb)
		b.WriteString(row)
	} else {
		b.WriteString(m.viewport.View())
	}
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
		return s.editorBox.Width(m.width - 2).Render(
			lipgloss.NewStyle().Foreground(theme.Current.Primary).Render("◐ ") + label,
		)
	}
	if m.approval != "" {
		return s.editorBox.Width(m.width-2).BorderForeground(theme.Current.Warning).Render(
			lipgloss.NewStyle().Foreground(theme.Current.Warning).Render(
				fmt.Sprintf("Approve %s? [y/Enter] yes  [n] no", m.approval),
			),
		)
	}

	// @-completion dropdown above the editor.
	dropdown := ""
	if q, ok := m.activeAtQuery(); ok {
		matches := filterFiles(m.filePaths, q, fileCompletionLimit)
		if d := fileCompletion(matches, m.fileIndex, m.width); d != "" {
			dropdown = d + "\n"
		}
	}
	return dropdown + s.editorBox.Width(m.width-2).Render(m.editor.View())
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
		"ctrl+o   model picker",
		"ctrl+t   theme switcher",
		"ctrl+b   toggle files sidebar",
		"ctrl+c   exit",
		"@        file completion",
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
	vpHeight := m.height - m.inputHeight() - 1
	if vpHeight < 1 {
		vpHeight = 1
	}
	vpWidth := m.width
	if m.sidebarVisible() {
		vpWidth = m.width - m.sidebarWidth()
	}
	if m.viewport.Width == 0 {
		m.viewport = viewport.New(vpWidth, vpHeight)
	} else {
		m.viewport.Width = vpWidth
		m.viewport.Height = vpHeight
	}
	m.editor.SetWidth(m.width - 4)
}

func (m Model) sidebarVisible() bool { return m.showSidebar && m.width >= 80 }

func (m Model) sidebarWidth() int {
	w := m.width * 28 / 100
	if w > 32 {
		w = 32
	}
	return w
}

func (m Model) inputHeight() int { return 3 }

func (m Model) contentWidth() int {
	w := m.width - 4
	if m.sidebarVisible() {
		w -= m.sidebarWidth()
	}
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

// themeFor returns the theme for a name (for preview-revert comparison).
func themeFor(name string) theme.Theme {
	for _, n := range theme.Named {
		if n.Name == name {
			return n.Theme
		}
	}
	return theme.OpenCode
}
