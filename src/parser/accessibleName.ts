// Resolve a field's accessible name in ARIA priority order and record how sure
// we are. Confidence is the whole honesty story: `low` means the field is sent
// to needs_human and is never filled silently.

export interface NameResult {
  name: string;
  confidence: 'high' | 'medium' | 'low';
  source: string;
}

export function accessibleName(el: HTMLElement): NameResult {
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return { name: aria, confidence: 'high', source: 'aria-label' };

  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (text) return { name: text, confidence: 'high', source: 'aria-labelledby' };
  }

  if (el.id) {
    const label = document.querySelector<HTMLLabelElement>(
      `label[for="${CSS.escape(el.id)}"]`
    );
    const text = label?.textContent?.trim();
    if (text) return { name: text, confidence: 'high', source: 'label-for' };
  }

  const wrapping = el.closest('label')?.textContent?.trim();
  if (wrapping) return { name: wrapping, confidence: 'medium', source: 'label-wrap' };

  const ph = el.getAttribute('placeholder')?.trim();
  if (ph) return { name: ph, confidence: 'low', source: 'placeholder' };

  const nameAttr = el.getAttribute('name');
  if (nameAttr) return { name: nameAttr, confidence: 'low', source: 'name-attr' };

  return { name: '', confidence: 'low', source: 'none' };
}
