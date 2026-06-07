package ui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/asaferdman23/mint-cli/tui-go/protocol"
)

// newTestModel builds a model sized for rendering, without a live bridge.
func newTestModel() Model {
	m := New(nil, "diff", "opencode")
	m.width, m.height = 80, 24
	m.layout()
	m.md = newMarkdownRenderer(m.contentWidth())
	m.ready = true
	return m
}

func TestRenderMessages_Borders(t *testing.T) {
	msgs := []message{
		{role: roleUser, content: "hello there"},
		{role: roleAssistant, content: "# Title\nsome **bold** text", model: "claude-sonnet-4", durationMs: 2300, cost: 0.0042},
	}
	out := renderMessages(msgs, "", 60, newMarkdownRenderer(60))

	if !strings.Contains(out, "You") {
		t.Error("missing user name header")
	}
	if !strings.Contains(out, "Mint") {
		t.Error("missing assistant name header")
	}
	if !strings.Contains(out, iconThick) {
		t.Error("missing thick left border")
	}
	if !strings.Contains(out, "claude-sonnet-4") {
		t.Error("missing model footer")
	}
	if !strings.Contains(out, "2.3s") {
		t.Error("missing duration footer")
	}
}

func TestStatusBar(t *testing.T) {
	out := statusBar("claude-opus-4", "yolo", 45200, 0.0123, 80)
	if !strings.Contains(out, "ctrl+h help") {
		t.Error("missing help hint")
	}
	if !strings.Contains(out, "yolo") {
		t.Error("missing mode")
	}
	if !strings.Contains(out, "claude-opus-4") {
		t.Error("missing model")
	}
	if !strings.Contains(out, "45K") {
		t.Errorf("missing token count, got: %q", out)
	}
}

func TestApplyEvent_DoneUpdatesLastMessage(t *testing.T) {
	m := newTestModel()
	m.messages = []message{
		{role: roleUser, content: "do a thing"},
		{role: roleAssistant, streaming: true},
	}
	m.busy = true

	m.applyEvent(protocol.Event{
		Type: "done",
		Result: &protocol.Result{
			Output:       "Here is the result",
			Model:        "claude-sonnet-4",
			TotalCostUsd: 0.005,
			DurationMs:   1500,
		},
	})

	if m.busy {
		t.Error("expected busy=false after done")
	}
	last := m.messages[len(m.messages)-1]
	if last.content != "Here is the result" {
		t.Errorf("content not applied: %q", last.content)
	}
	if last.streaming {
		t.Error("expected streaming=false")
	}
	if last.model != "claude-sonnet-4" {
		t.Error("model not applied")
	}
}

func TestApplyEvent_TextDeltaAccumulates(t *testing.T) {
	m := newTestModel()
	m.messages = []message{{role: roleAssistant, streaming: true}}
	m.applyEvent(protocol.Event{Type: "text.delta", Text: "Hello "})
	m.applyEvent(protocol.Event{Type: "text.delta", Text: "world"})
	if m.streaming != "Hello world" {
		t.Errorf("streaming accumulation wrong: %q", m.streaming)
	}
}

func TestApplyEvent_CostAccumulates(t *testing.T) {
	m := newTestModel()
	m.applyEvent(protocol.Event{Type: "cost.delta", Usd: 0.001, InputTokens: 100, OutputTokens: 50})
	m.applyEvent(protocol.Event{Type: "cost.delta", Usd: 0.002, InputTokens: 200, OutputTokens: 80})
	if m.cost < 0.0029 || m.cost > 0.0031 {
		t.Errorf("cost wrong: %v", m.cost)
	}
	if m.tokens != 430 {
		t.Errorf("tokens wrong: %d", m.tokens)
	}
}

func TestHelpOverlayToggle(t *testing.T) {
	m := newTestModel()
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlH})
	m = updated.(Model)
	if m.overlay != "help" {
		t.Errorf("expected help overlay, got %q", m.overlay)
	}
	if !strings.Contains(m.View(), "Help") {
		t.Error("help view not rendered")
	}
}

func TestApprovalGate(t *testing.T) {
	m := newTestModel()
	m.applyEvent(protocol.Event{Type: "approval.needed", Reason: "diff"})
	if m.approval != "diff" {
		t.Errorf("approval not set: %q", m.approval)
	}
	if !strings.Contains(m.inputView(), "Approve diff") {
		t.Error("approval prompt not rendered")
	}
}
