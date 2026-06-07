// Package protocol defines the NDJSON wire format between the Go TUI and the
// existing TypeScript brain, and a bridge that drives the node subprocess.
package protocol

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
)

// Event mirrors the brain's AgentEvent union. Only the fields the TUI needs are
// decoded; unknown fields are ignored. `Type` discriminates the variant.
type Event struct {
	Type string `json:"type"`
	Ts   int64  `json:"ts"`

	// classify
	Kind       string  `json:"kind,omitempty"`
	Complexity string  `json:"complexity,omitempty"`
	Model      string  `json:"model,omitempty"`
	Confidence float64 `json:"confidence,omitempty"`
	Source     string  `json:"source,omitempty"`
	Reasoning  string  `json:"reasoning,omitempty"`

	// context.retrieved
	Files       []FileRef `json:"files,omitempty"`
	TokensUsed  int       `json:"tokensUsed,omitempty"`
	TokenBudget int       `json:"tokenBudget,omitempty"`

	// phase
	Name       string `json:"name,omitempty"`
	Status     string `json:"status,omitempty"`
	DurationMs int    `json:"durationMs,omitempty"`

	// text.delta
	Text string `json:"text,omitempty"`

	// tool.call / tool.result
	ID    string                 `json:"id,omitempty"`
	Input map[string]interface{} `json:"input,omitempty"`
	OK    bool                   `json:"ok,omitempty"`
	Output string                `json:"output,omitempty"`

	// diff.proposed / diff.applied
	File      string `json:"file,omitempty"`
	Additions int    `json:"additions,omitempty"`
	Deletions int    `json:"deletions,omitempty"`

	// cost.delta
	Usd          float64 `json:"usd,omitempty"`
	InputTokens  int     `json:"inputTokens,omitempty"`
	OutputTokens int     `json:"outputTokens,omitempty"`

	// approval.needed
	Reason string `json:"reason,omitempty"`

	// warn / error
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`

	// done
	Result *Result `json:"result,omitempty"`
}

// FileRef is a retrieved-context file reference.
type FileRef struct {
	Path string `json:"path"`
}

// Result is the brain's terminal summary.
type Result struct {
	Output       string  `json:"output"`
	Model        string  `json:"model"`
	TotalCostUsd float64 `json:"totalCostUsd"`
	InputTokens  int     `json:"inputTokens"`
	OutputTokens int     `json:"outputTokens"`
	Iterations   int     `json:"iterations"`
	ToolCalls    int     `json:"toolCalls"`
	DurationMs   int     `json:"durationMs"`
}

// Command is sent from the TUI to the brain over the child's stdin.
type Command struct {
	Type  string `json:"type"`            // "prompt" | "approval" | "cancel"
	Task  string `json:"task,omitempty"`  // for prompt
	Mode  string `json:"mode,omitempty"`  // for prompt
	Model string `json:"model,omitempty"` // for prompt (optional override)
	OK    bool   `json:"ok,omitempty"`    // for approval
}

// Bridge owns the node child process and the NDJSON streams.
type Bridge struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Scanner
	enc    *json.Encoder
}

// Start spawns `node <entry> stream-agent` and wires up the pipes.
func Start(ctx context.Context, nodeBin, entry, cwd string) (*Bridge, error) {
	cmd := exec.CommandContext(ctx, nodeBin, entry, "stream-agent")
	cmd.Dir = cwd

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	// Surface child stderr through our own stderr for debugging.
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start node: %w", err)
	}

	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024) // allow large lines

	return &Bridge{
		cmd:    cmd,
		stdin:  stdin,
		stdout: sc,
		enc:    json.NewEncoder(stdin),
	}, nil
}

// Send writes a command to the brain.
func (b *Bridge) Send(c Command) error {
	return b.enc.Encode(c)
}

// Next blocks for the next event. Returns io.EOF when the stream closes.
func (b *Bridge) Next() (Event, error) {
	for b.stdout.Scan() {
		line := b.stdout.Bytes()
		if len(line) == 0 {
			continue
		}
		var ev Event
		if err := json.Unmarshal(line, &ev); err != nil {
			// Skip non-JSON noise (e.g. stray logs).
			continue
		}
		return ev, nil
	}
	if err := b.stdout.Err(); err != nil {
		return Event{}, err
	}
	return Event{}, io.EOF
}

// Close terminates the child process.
func (b *Bridge) Close() error {
	_ = b.stdin.Close()
	if b.cmd.Process != nil {
		_ = b.cmd.Process.Kill()
	}
	return b.cmd.Wait()
}
