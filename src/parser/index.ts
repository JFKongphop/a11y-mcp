import { accessibleName } from './accessibleName';
import { shouldTranslate } from './classify';
import { extractConstraints, type FieldConstraints } from './constraints';

export interface Field {
  id: string;
  label: string;
  type: string;
  required: boolean;
  confidence: 'high' | 'medium' | 'low';
  translate: boolean;
  group?: string;
  constraints: FieldConstraints;
}

export interface ParsedForm {
  formId: string;
  fields: Field[];
  submitLabel: string;
}

function isFillable(el: HTMLElement): boolean {
  const input = el as HTMLInputElement;
  const t = input.type;
  return t !== 'hidden' && t !== 'submit' && t !== 'button' && t !== 'reset' && !input.disabled;
}

export function parseForm(form: HTMLFormElement, index = 0): ParsedForm {
  const els = Array.from(
    form.querySelectorAll<HTMLElement>('input, select, textarea')
  ).filter(isFillable);

  const fields: Field[] = els.map((el, i) => {
    const { name, confidence } = accessibleName(el);
    const type = (el as HTMLInputElement).type ?? el.tagName.toLowerCase();
    const key = el.id || el.getAttribute('name') || `field_${i}`;

    return {
      id: key,
      label: name || key,
      type,
      required:
        el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
      confidence,
      translate: shouldTranslate(el, type, name),
      group: el.closest('fieldset')?.querySelector('legend')?.textContent?.trim() || undefined,
      constraints: extractConstraints(el),
    };
  });

  const submitEl = form.querySelector<HTMLElement>('[type=submit], button:not([type=button])');

  return {
    formId: form.id || `form_${index}`,
    fields,
    submitLabel: submitEl?.textContent?.trim() || 'Submit',
  };
}

export function findElement(form: HTMLFormElement, fieldId: string): HTMLElement | null {
  return (
    form.querySelector<HTMLElement>(`#${CSS.escape(fieldId)}`) ??
    form.querySelector<HTMLElement>(`[name="${CSS.escape(fieldId)}"]`)
  );
}
