// A small fixed status toast in the MAIN world. It shows what the agent heard
// and what it did — doubles as on-screen subtitles for the demo. Purely visual;
// the authoritative spoken feedback goes through Paxa TTS.

let el: HTMLDivElement | null = null;

function ensure(): HTMLDivElement {
  if (el && document.body.contains(el)) return el;
  el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText =
    'position:fixed;left:16px;bottom:84px;z-index:2147483646;max-width:360px;' +
    'background:#111;color:#fff;padding:10px 14px;border-radius:10px;' +
    'font:13px/1.4 system-ui;box-shadow:0 4px 16px rgba(0,0,0,.3);white-space:pre-wrap';
  document.body.appendChild(el);
  return el;
}

export function showStatus(text: string) {
  const box = ensure();
  box.textContent = text;
  box.hidden = false;
}

export function clearStatus() {
  if (el) el.hidden = true;
}
