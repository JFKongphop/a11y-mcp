// Shared postMessage protocol between the MAIN world (DOM + WebMCP tools) and
// the ISOLATED world (chrome.* APIs + fetch to the Paxa proxy).
//
// MAIN and ISOLATED share no globals — they only talk over window.postMessage.
// Every message carries the __a11y_mcp marker so we can ignore unrelated page
// traffic, and we always check e.source === window on receipt.

export const MARKER = '__a11y_mcp' as const;

export type MainToIsolated =
  | { type: 'speak'; text: string }
  | { type: 'translate'; reqId: string; text: string; source?: string; target?: string }
  | { type: 'parse-report'; report: ParseReport }
  // Re-open the mic to continue the conversation (e.g. to hear the user's answer
  // to a clarification question). The brain sends this after it speaks.
  | { type: 'listen' };

export type IsolatedToMain =
  | { type: 'translate-result'; reqId: string; text: string }
  | { type: 'mic-result'; text: string };

export interface ParseReport {
  href: string;
  hasForm: boolean;
  mapped: number; // high/medium confidence fields
  ambiguous: number; // medium confidence
  unlabeled: number; // low confidence -> needs_human
  total: number;
}

type AnyMsg = (MainToIsolated | IsolatedToMain) & { [MARKER]: true };

function post(msg: MainToIsolated | IsolatedToMain) {
  window.postMessage({ [MARKER]: true, ...msg }, '*');
}

/** Send from the MAIN world to the ISOLATED world. */
export function postToIsolated(msg: MainToIsolated) {
  post(msg);
}

/** Send from the ISOLATED world back to the MAIN world. */
export function postToMain(msg: IsolatedToMain) {
  post(msg);
}

/** Subscribe to marked messages. Returns an unsubscribe function. */
export function onBridgeMessage(handler: (msg: AnyMsg) => void): () => void {
  const listener = (e: MessageEvent) => {
    if (e.source !== window) return; // any page script can postMessage
    const data = e.data as AnyMsg | undefined;
    if (!data || data[MARKER] !== true) return;
    handler(data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
