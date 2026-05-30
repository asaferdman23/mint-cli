// src/tui/hooks/useQuotaWarnings.ts
// Owns the gateway quota fetch + threshold-warning generation. Pushes notices
// via the provided callback so the parent component decides how to display
// them (currently: as assistant messages in the chat transcript).
//
// Threshold contract (AGENT.md §7): yellow warning at ≥80%, red exceeded
// notice at ≥100%. Each threshold fires at most once per session — we use a
// ref so React state updates don't cause re-fires.
//
// Offline UX: ../../utils/quotaCache caches the last successful response in
// ~/.mint-quota-cache.json so the status bar keeps showing *something* when
// the gateway is unreachable. Cache-only seeds skip threshold checks because
// they don't carry a guaranteed plan_type.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchQuota as fetchQuotaCached } from '../../utils/quotaCache.js';

export interface QuotaNotice {
  /** Stable id; consumer assigns its own (we just signal level). */
  level: 'approaching' | 'exceeded';
  text: string;
}

export interface UseQuotaWarningsOptions {
  /** Called once per threshold crossing. Idempotent across renders. */
  onNotice: (notice: QuotaNotice) => void;
}

export interface UseQuotaWarningsReturn {
  quotaUsed: number | undefined;
  quotaLimit: number | undefined;
  /** Re-poll the gateway. Call after a task completes. */
  fetchQuota: () => Promise<void>;
}

export function useQuotaWarnings({ onNotice }: UseQuotaWarningsOptions): UseQuotaWarningsReturn {
  const [quotaUsed, setQuotaUsed] = useState<number | undefined>(undefined);
  const [quotaLimit, setQuotaLimit] = useState<number | undefined>(undefined);
  // Track which quota thresholds we've warned about so we don't spam the chat
  // with the same message after every task.
  const quotaWarningShownRef = useRef<'none' | 'approaching' | 'exceeded'>('none');

  // Keep onNotice in a ref so fetchQuota's identity doesn't churn when the
  // parent recreates the callback. Mirror the existing fetchQuota dep behavior.
  const onNoticeRef = useRef(onNotice);
  useEffect(() => {
    onNoticeRef.current = onNotice;
  }, [onNotice]);

  const fetchQuota = useCallback(async () => {
    const seedFromCache = quotaUsed == null;
    const result = await fetchQuotaCached({ seedFromCache });
    if (!result) return;

    setQuotaUsed(result.used);
    setQuotaLimit(result.limit);

    // Only free-tier users get quota warnings; pro/enterprise have no cap.
    // Cache-only seed has no plan_type guarantee — skip threshold checks until
    // we hear from the gateway directly.
    if (result.fromCache) return;
    if (result.planType !== 'free' || result.limit <= 0) return;

    const usagePercent = (result.used / result.limit) * 100;
    const shown = quotaWarningShownRef.current;

    if (usagePercent >= 100 && shown !== 'exceeded') {
      quotaWarningShownRef.current = 'exceeded';
      onNoticeRef.current({
        level: 'exceeded',
        text: `✗ You've used all ${result.limit} free requests.\n\nTo continue:\n  • Upgrade to Pro at https://usemint.dev/upgrade\n  • Add your own API keys: mint config:set providers.anthropic <key>`,
      });
    } else if (usagePercent >= 80 && usagePercent < 100 && shown === 'none') {
      quotaWarningShownRef.current = 'approaching';
      const remaining = result.limit - result.used;
      onNoticeRef.current({
        level: 'approaching',
        text: `⚠ You've used ${result.used} of your ${result.limit} free requests (${remaining} remaining).\n\nTo continue after your quota:\n  • Upgrade to Pro for unlimited requests\n  • Add your own API keys with: mint config:set providers.anthropic <key>`,
      });
    }
  }, [quotaUsed]);

  useEffect(() => {
    fetchQuota();
  }, [fetchQuota]);

  return { quotaUsed, quotaLimit, fetchQuota };
}
