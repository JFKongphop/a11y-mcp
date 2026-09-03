// Constraint extraction helpers, kept separate so the parser reads cleanly and
// the numeric-attribute coercion lives in one place.

export interface FieldConstraints {
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
}

export function numAttr(el: HTMLElement, attr: string): number | undefined {
  const v = el.getAttribute(attr);
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

export function selectOptions(el: HTMLElement): { value: string; label: string }[] | undefined {
  if (el.tagName !== 'SELECT') return undefined;
  return Array.from((el as HTMLSelectElement).options)
    .filter((o) => o.value !== '') // drop empty-value placeholders ("— select —")
    .map((o) => ({ value: o.value, label: o.textContent?.trim() ?? o.value }));
}

export function extractConstraints(el: HTMLElement): FieldConstraints {
  return {
    pattern: el.getAttribute('pattern') ?? undefined,
    minLength: numAttr(el, 'minlength'),
    maxLength: numAttr(el, 'maxlength'),
    min: numAttr(el, 'min'),
    max: numAttr(el, 'max'),
    options: selectOptions(el),
  };
}
