package ui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/asaferdman23/mint-cli/tui-go/protocol"
)

func TestMetaPopulatesPickers(t *testing.T) {
	m := newTestModel()
	m.applyEvent(protocol.Event{Type: "meta",
		Models: []protocol.ModelInfo{{ID: "claude-opus-4", Tier: "apex"}, {ID: "groq-8b", Tier: "ultra"}},
		Paths:  []string{"src/a.ts", "src/b.ts"},
	})
	if len(m.models) != 2 || len(m.filePaths) != 2 {
		t.Fatalf("meta not applied: %d models, %d files", len(m.models), len(m.filePaths))
	}
}

func TestModelPickerOpensAndCommits(t *testing.T) {
	m := newTestModel()
	m.applyEvent(protocol.Event{Type: "meta", Models: []protocol.ModelInfo{
		{ID: "claude-opus-4", Tier: "apex"}, {ID: "claude-sonnet-4", Tier: "smart"},
	}})
	u, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlO})
	m = u.(Model)
	if m.overlay != "model" {
		t.Fatalf("picker did not open: %q", m.overlay)
	}
	if !strings.Contains(m.View(), "Select model") {
		t.Error("model dialog not rendered")
	}
	u, _ = m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m = u.(Model)
	u, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = u.(Model)
	if m.model != "claude-sonnet-4" {
		t.Errorf("model not committed: %q", m.model)
	}
	if m.overlay != "" {
		t.Error("overlay did not close")
	}
}

func TestThemeSwitcherPreviewAndApply(t *testing.T) {
	m := newTestModel()
	u, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlT})
	m = u.(Model)
	if m.overlay != "theme" {
		t.Fatal("theme overlay did not open")
	}
	u, _ = m.Update(tea.KeyMsg{Type: tea.KeyDown}) // preview tokyonight
	m = u.(Model)
	u, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = u.(Model)
	if m.themeName != "tokyonight" {
		t.Errorf("theme not applied: %q", m.themeName)
	}
}

func TestSidebarToggleAndFileTracking(t *testing.T) {
	m := newTestModel()
	m.applyEvent(protocol.Event{Type: "tool.call", Name: "edit_file",
		Input: map[string]interface{}{"path": "src/loop.ts"}})
	m.applyEvent(protocol.Event{Type: "tool.call", Name: "write_file",
		Input: map[string]interface{}{"path": "src/new.ts"}})
	if len(m.files) != 2 {
		t.Fatalf("files not tracked: %d", len(m.files))
	}
	u, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlB})
	m = u.(Model)
	if !m.showSidebar {
		t.Error("sidebar not toggled on")
	}
	out := sidebar(m.files, 1000, 0.01, 30, 12)
	if !strings.Contains(out, "Files") || !strings.Contains(out, "loop.ts") {
		t.Error("sidebar render missing content")
	}
}

func TestFileCompletionFilterAndApply(t *testing.T) {
	m := newTestModel()
	m.filePaths = []string{"src/brain/loop.ts", "src/tui/app.tsx", "README.md"}
	m.editor.SetValue("look at @loop")
	q, ok := m.activeAtQuery()
	if !ok || q != "loop" {
		t.Fatalf("at-query wrong: %q ok=%v", q, ok)
	}
	matches := filterFiles(m.filePaths, q, 50)
	if len(matches) != 1 || matches[0] != "src/brain/loop.ts" {
		t.Fatalf("filter wrong: %v", matches)
	}
	m.applyFileCompletion(matches[0])
	if m.editor.Value() != "look at @src/brain/loop.ts " {
		t.Errorf("completion not applied: %q", m.editor.Value())
	}
}
