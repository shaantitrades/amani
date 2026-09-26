import { useCallback } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { syncOutbox, pendingCount, draftPreview } from '../lib/outbox.js';

/** Synchronisation de la file de publication hors ligne. */
export function useSync() {
  const { setPending, setDrafts, announce, online } = useApp();

  const refresh = useCallback(async () => {
    const [count, preview] = await Promise.all([pendingCount(), draftPreview()]);
    setPending(count);
    setDrafts(preview);
    return preview;
  }, [setDrafts, setPending]);

  const sync = useCallback(
    async ({ silent = false } = {}) => {
      if (!online) return { synced: 0, failed: 0, offline: true };
      try {
        const result = await syncOutbox();
        await refresh();
        if (!silent) {
          if (result.synced > 0) announce('ad_published');
          else if (result.errors?.length) announce('error_generic');
          else announce('synced');
        }
        return result;
      } catch (err) {
        if (!silent) announce('error_generic');
        return { synced: 0, failed: 1, errors: [err.message] };
      }
    },
    [announce, online, refresh],
  );

  return { sync, refresh };
}

export default useSync;
