import { z } from 'zod';

// Zod defines the tool-boundary shapes once: it gives us runtime validation of
// whatever the agent passes in, and a matching JSON Schema for tool
// registration. The DOM-derived per-field constraints live in the parser; this
// file only guards the tool call surface itself.

// Values are coerced to strings: an LLM tool-call sometimes emits a number or
// boolean (e.g. stay_days: 14) even when the schema says string. Coerce rather
// than reject so a well-intentioned call still fills the form.
export const fillFormArgs = z.object({
  values: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v))
  ),
  // Field ids the user has EXPLICITLY confirmed (e.g. after answering a
  // clarification question). These bypass the low-confidence needs_human guard —
  // a human approved them, so filling is no longer a silent guess.
  confirmed: z.array(z.string()).optional(),
});
export type FillFormArgs = z.infer<typeof fillFormArgs>;

export const emptyArgs = z.object({}).strict().optional();

// Hand-authored JSON Schema kept in lockstep with the Zod shapes above. Small
// enough that a codegen dependency would cost more than it saves.
export const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  required: [] as string[],
} as const;

export const FILL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    values: {
      type: 'object',
      description: 'Map of field id (from describe_form) to the string value to fill.',
      additionalProperties: { type: 'string' },
    },
    confirmed: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Field ids the user explicitly confirmed (e.g. after you asked a clarification ' +
        'question). Only these bypass the needs_human guard; never list a field the user did not confirm.',
    },
  },
  required: ['values'],
} as const;

/** Parse tool args defensively; returns a typed result or a reason string. */
export function parseFillArgs(raw: unknown): FillFormArgs | { error: string } {
  const result = fillFormArgs.safeParse(raw);
  if (!result.success) {
    return { error: result.error.issues.map((i) => i.message).join('; ') || 'invalid arguments' };
  }
  return result.data;
}
