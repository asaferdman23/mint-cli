// src/tui/hooks/useMouseScroll.ts
//
// Mouse-wheel scrolling for the brain TUI.
//
// Ink uses the alternate screen buffer, which disables the terminal emulator's
// native scrollback for the duration of the session. Without this hook the
// mouse wheel does nothing — frustrating when scanning a long assistant reply.
//
// Implementation: switch the terminal into SGR mouse-tracking mode (1006) +
// button-event mode (1002) on mount, parse the SGR sequences from stdin, and
// fire callbacks for wheel-up / wheel-down. On unmount (and on process exit
// as a belt-and-braces guard) we send the disable sequences so the user's
// terminal isn't left in a weird state.
//
// SGR mouse event format: `ESC [ < B ; X ; Y (M|m)`
//   B = button code; wheel-up is 64, wheel-down is 65. Modifier bits (Shift/
//   Ctrl/Alt) live in higher bits — we mask them so e.g. Shift+wheel still
//   scrolls.
import { useEffect, useRef } from 'react';
import { useStdin, useStdout } from 'ink';

const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';
const SGR_RE = /\x1b\[<(\d+);\d+;\d+([Mm])/g;

export interface UseMouseScrollOptions {
  onWheelUp: () => void;
  onWheelDown: () => void;
  /** Set to false to opt out without unmounting the hook. */
  enabled?: boolean;
}

export function useMouseScroll({
  onWheelUp,
  onWheelDown,
  enabled = true,
}: UseMouseScrollOptions): void {
  const { stdin, isRawModeSupported } = useStdin();
  const { stdout } = useStdout();

  // Callbacks captured in refs so the enable/disable effect doesn't re-run
  // every parent render (which would thrash MOUSE_ON / MOUSE_OFF writes).
  const upRef = useRef(onWheelUp);
  const downRef = useRef(onWheelDown);
  useEffect(() => {
    upRef.current = onWheelUp;
    downRef.current = onWheelDown;
  }, [onWheelUp, onWheelDown]);

  useEffect(() => {
    if (!enabled || !isRawModeSupported || !stdin || !stdout) return;

    stdout.write(MOUSE_ON);
    const restore = (): void => {
      stdout.write(MOUSE_OFF);
    };
    // Belt-and-braces — if the process exits before React's cleanup runs
    // (Ctrl+C, uncaught error), still drop the terminal out of mouse mode.
    process.once('exit', restore);

    const onData = (data: Buffer): void => {
      const str = data.toString('utf8');
      // Reset the regex's lastIndex since we're using /g state across calls.
      SGR_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = SGR_RE.exec(str)) !== null) {
        const button = parseInt(match[1], 10) & 0b1100011; // strip modifier bits
        if (button === 64) upRef.current();
        else if (button === 65) downRef.current();
      }
    };
    stdin.on('data', onData);

    return () => {
      stdin.off('data', onData);
      process.off('exit', restore);
      restore();
    };
  }, [stdin, stdout, isRawModeSupported, enabled]);
}
