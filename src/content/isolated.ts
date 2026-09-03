import { onBridgeMessage, postToMain, type ParseReport } from './bridge';
import { speakThai, toThai } from '../voice/client';
import { listenThai, type MicHandle } from '../voice/mic';

// ISOLATED world content script. Has chrome.* APIs and can fetch the Paxa proxy,
// but cannot see the page's navigator.modelContext. It handles the network side
// of the bridge, stores the latest parse report for the popup, and owns the mic
// button (Web Speech API needs a user gesture, which the button provides).

let lastReport: ParseReport | null = null;

onBridgeMessage(async (msg) => {
  switch (msg.type) {
    case 'speak':
      try {
        await speakThai(msg.text);
      } catch (e) {
        console.warn('[a11y-mcp] speak failed', e);
      }
      break;

    case 'translate':
      try {
        const text = await toThai(msg.text, msg.source, msg.target);
        postToMain({ type: 'translate-result', reqId: msg.reqId, text });
      } catch {
        postToMain({ type: 'translate-result', reqId: msg.reqId, text: msg.text });
      }
      break;

    case 'parse-report':
      lastReport = msg.report;
      break;

    case 'listen':
      // Give the just-spoken audio a moment, then re-open the mic so the user
      // can answer without touching the button (conversational loop).
      setTimeout(startListening, 600);
      break;
  }
});

// The popup asks for the current tab's parse report.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'get-report') {
    sendResponse(lastReport);
  }
  return false;
});

// ---- Mic button -----------------------------------------------------------
// Injected floating button. A Thai transcript goes to the MAIN-world brain,
// which drives the tools. The brain can also re-open the mic (via the 'listen'
// bridge message) to hear the user's answer to a clarification question.

let mic: MicHandle | null = null;

function setMicActive(on: boolean) {
  const btn = document.getElementById('a11y-mcp-mic');
  if (btn) {
    btn.style.background = on ? '#c0392b' : '#111';
    btn.setAttribute('aria-pressed', String(on));
  }
}

function startListening() {
  if (mic) return; // already listening
  try {
    setMicActive(true);
    mic = listenThai(
      (text) => {
        mic = null;
        setMicActive(false);
        console.log('[a11y-mcp] heard:', text);
        postToMain({ type: 'mic-result', text });
      },
      (err) => {
        mic = null;
        setMicActive(false);
        console.warn('[a11y-mcp] mic error', err);
      }
    );
  } catch (e) {
    mic = null;
    setMicActive(false);
    console.warn('[a11y-mcp] mic unavailable', e);
  }
}

function injectMicButton() {
  if (document.getElementById('a11y-mcp-mic')) return;

  const btn = document.createElement('button');
  btn.id = 'a11y-mcp-mic';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'พูดคำสั่งเป็นภาษาไทย');
  btn.textContent = '🎤';
  btn.style.cssText =
    'position:fixed;left:16px;bottom:16px;z-index:2147483646;width:56px;height:56px;' +
    'border-radius:50%;border:0;background:#111;color:#fff;font-size:22px;cursor:pointer;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.3)';

  btn.onclick = () => {
    if (mic) {
      mic.stop();
      mic = null;
      setMicActive(false);
    } else {
      startListening();
    }
  };

  document.body.appendChild(btn);
}

if (document.body) injectMicButton();
else document.addEventListener('DOMContentLoaded', injectMicButton, { once: true });
