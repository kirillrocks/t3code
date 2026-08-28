import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";

import { orchestrationEnvironment } from "../state/orchestration";
import { useAtomCommand } from "../state/use-atom-command";

/**
 * Asks the server to summarize a thread with its text-generation model (the
 * same cheap model that writes titles). Resolves to null on any failure so
 * callers can fall back to a plain transcript.
 */
export function useThreadHandoffSummary(): (threadRef: ScopedThreadRef) => Promise<string | null> {
  const generate = useAtomCommand(orchestrationEnvironment.generateThreadHandoff, {
    reportFailure: false,
  });
  return useCallback(
    async (threadRef: ScopedThreadRef) => {
      const result = await generate({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      if (result._tag === "Failure") return null;
      const summary = result.value.summary.trim();
      return summary.length > 0 ? summary : null;
    },
    [generate],
  );
}
