// Stable failure enum + Thai strings. Templates, not model-generated prose: the
// same failure must speak identically every time and must work with no model
// call. Never let a model write the error text.

export type Reason =
  | 'pattern_mismatch'
  | 'out_of_range'
  | 'required_missing'
  | 'too_long'
  | 'too_short'
  | 'not_an_option';

export interface FieldError {
  field: string;
  label: string;
  reason: Reason;
  expected?: string;
  got?: string;
}

const TH: Record<Reason, (e: FieldError) => string> = {
  pattern_mismatch: (e) => `ช่อง ${e.label} รูปแบบไม่ถูกต้อง ต้องเป็น ${e.expected}`,
  out_of_range: (e) => `ช่อง ${e.label} ต้องอยู่ในช่วง ${e.expected} คุณกรอก ${e.got}`,
  required_missing: (e) => `ช่อง ${e.label} จำเป็นต้องกรอก`,
  too_long: (e) => `ช่อง ${e.label} ยาวเกินไป ต้องไม่เกิน ${e.expected} ตัวอักษร`,
  too_short: (e) => `ช่อง ${e.label} สั้นเกินไป ต้องอย่างน้อย ${e.expected} ตัวอักษร`,
  not_an_option: (e) => `ช่อง ${e.label} ไม่มีตัวเลือกนี้ เลือกได้จาก ${e.expected}`,
};

export const thaiError = (e: FieldError): string => TH[e.reason](e);
