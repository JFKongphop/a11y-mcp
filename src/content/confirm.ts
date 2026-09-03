import { findElement, type ParsedForm } from '../parser';
import { postToIsolated } from './bridge';

// submit_form must block on a real human decision. We render a fixed overlay
// listing every value about to be submitted, speak a Thai summary through the
// Paxa proxy (via the ISOLATED world), and resolve only on an explicit click.
// This is the human-in-the-loop boundary the whole design is built around.

export function confirmWithUser(parsed: ParsedForm, form: HTMLFormElement): Promise<boolean> {
  const lines = parsed.fields
    .map((f) => {
      const el = findElement(form, f.id) as HTMLInputElement | null;
      return el?.value ? `${f.label}: ${el.value}` : null;
    })
    .filter((l): l is string => l !== null);

  postToIsolated({ type: 'speak', text: `กำลังจะส่งข้อมูล ${lines.length} รายการ` });

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-live', 'assertive');
    overlay.setAttribute('aria-label', 'ยืนยันการส่งฟอร์ม');
    overlay.style.cssText =
      'position:fixed;inset:auto 16px 16px auto;z-index:2147483647;background:#fff;' +
      'color:#111;padding:16px;border:2px solid #111;border-radius:8px;max-width:360px;' +
      'font:14px system-ui;box-shadow:0 8px 32px rgba(0,0,0,.25)';

    const heading = document.createElement('strong');
    heading.textContent = 'ยืนยันการส่ง';
    overlay.appendChild(heading);

    const list = document.createElement('ul');
    list.style.cssText = 'margin:8px 0;padding-left:18px;max-height:240px;overflow:auto';
    for (const line of lines) {
      const li = document.createElement('li');
      li.textContent = line; // textContent, not innerHTML — values are untrusted
      list.appendChild(li);
    }
    overlay.appendChild(list);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:8px';
    const yes = document.createElement('button');
    yes.textContent = 'ยืนยัน';
    yes.style.cssText = 'flex:1;padding:8px;background:#111;color:#fff;border:0;border-radius:6px;cursor:pointer';
    const no = document.createElement('button');
    no.textContent = 'ยกเลิก';
    no.style.cssText = 'flex:1;padding:8px;background:#eee;color:#111;border:0;border-radius:6px;cursor:pointer';
    row.append(yes, no);
    overlay.appendChild(row);

    document.body.appendChild(overlay);

    const close = (result: boolean) => {
      overlay.remove();
      resolve(result);
    };
    yes.onclick = () => close(true);
    no.onclick = () => close(false);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(false);
    });
    yes.focus();
  });
}
