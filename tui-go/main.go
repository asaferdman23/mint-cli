// Command mint-tui is a BubbleTea/Lipgloss terminal UI for the Mint CLI.
// It renders entirely in Go and drives the existing TypeScript brain over an
// NDJSON protocol (see package protocol).
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/asaferdman23/mint-cli/tui-go/protocol"
	"github.com/asaferdman23/mint-cli/tui-go/theme"
	"github.com/asaferdman23/mint-cli/tui-go/ui"
)

func main() {
	var (
		nodeBin    = flag.String("node", "node", "path to the node binary")
		entry      = flag.String("entry", "", "path to the mint CLI entry (dist/cli/index.js)")
		mode       = flag.String("mode", "diff", "agent mode: diff|auto|plan|yolo")
		themeName  = flag.String("theme", "opencode", "color theme")
		cwd        = flag.String("cwd", "", "working directory (default: current)")
	)
	flag.Parse()

	if *entry == "" {
		fmt.Fprintln(os.Stderr, "error: --entry <path to dist/cli/index.js> is required")
		os.Exit(2)
	}
	theme.SetByName(*themeName)

	workdir := *cwd
	if workdir == "" {
		workdir, _ = os.Getwd()
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	bridge, err := protocol.Start(ctx, *nodeBin, *entry, workdir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: failed to start brain: %v\n", err)
		os.Exit(1)
	}
	defer bridge.Close()

	p := tea.NewProgram(ui.New(bridge, *mode, *themeName), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}
