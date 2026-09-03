import { modelContextAvailable, startToolSync } from '../tools/register';
import { onBridgeMessage } from './bridge';
import { runAgent } from '../agent/brain';

// MAIN world content script. This is the only place that can reach
// document.modelContext (the page's own object) and touch the DOM. It has no
// chrome.* APIs — network calls to Paxa go through the ISOLATED world over the
// postMessage bridge.
//
// Phase 1 lives here too: before anything else we prove injection works and log
// the real method list, because the WebMCP spec is unstable and only the
// runtime is authoritative. The API moved from navigator.modelContext to
// document.modelContext (navigator was deprecated in Chrome 150).

function boot() {
  if (!window.isSecureContext) {
    console.warn('[a11y-mcp] not a secure context — document.modelContext is [SecureContext] only');
    return;
  }

  const mc = (document as any).modelContext;
  if (!mc) {
    console.warn('[a11y-mcp] document.modelContext unavailable — enable #enable-webmcp-testing in chrome://flags (Chrome 149+) and relaunch');
    return;
  }

  // Log the actual surface. Sources conflict on the exact API; trust this.
  try {
    const proto = Object.getPrototypeOf(mc);
    console.log('[a11y-mcp] modelContext methods:', proto ? Object.keys(proto) : Object.keys(mc));
  } catch {
    /* ignore */
  }

  if (!modelContextAvailable()) {
    console.warn('[a11y-mcp] registerTool not found on modelContext — API may have been renamed');
    return;
  }

  startToolSync();
  console.log('[a11y-mcp] tool sync started');

  // The mic button (ISOLATED world) sends the Thai transcript here; the brain
  // turns it into WebMCP tool calls.
  onBridgeMessage((m) => {
    if (m.type === 'mic-result') runAgent(m.text);
  });
}

boot();
