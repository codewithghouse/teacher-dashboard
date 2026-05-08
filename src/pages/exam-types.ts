// Shared shape for AI-generated exam papers — consumed by Exam.tsx UI render
// and by examPaperCache for storage. Kept loose (all fields optional) because
// the AI response is best-effort JSON; the renderer falls back to placeholder
// text rather than throwing on missing fields.

export interface GeneratedQuestion {
  number?: number | string;
  type?: string;
  marks?: number;
  question?: string;
  options?: string[];
  answer?: string;
  solution?: string;
}

export interface GeneratedSection {
  title?: string;
  instructions?: string;
  marks?: number;
  questions?: GeneratedQuestion[];
}

export interface GeneratedPaper {
  title?: string;
  subject?: string;
  grade?: string;
  board?: string;
  duration?: string;
  totalMarks?: number;
  generalInstructions?: string[];
  sections?: GeneratedSection[];
}
