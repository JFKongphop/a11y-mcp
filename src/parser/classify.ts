// Preserve-or-translate. The user speaks Thai; the form needs English. Get this
// wrong and you submit ประเทศไทย into a field expecting "Thailand". When
// uncertain, preserve — a wrong-language value is worse than an untranslated one.

const PRESERVE_TYPES = new Set([
  'email',
  'tel',
  'number',
  'url',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
  'password',
]);

const PRESERVE_HINTS = /passport|iban|swift|postcode|zip|code|id|number|no\.|account/i;

export function shouldTranslate(el: HTMLElement, type: string, label: string): boolean {
  if (PRESERVE_TYPES.has(type)) return false;
  if (el.hasAttribute('pattern')) return false;
  if (PRESERVE_HINTS.test(label)) return false;
  if (el.getAttribute('autocomplete')?.includes('name')) return false;
  return true;
}
