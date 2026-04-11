// ExcaliClaude — Element author tracking
//
// Attribuisce gli elementi a "claude" o "human" tramite customData.author,
// così che il canvas server (in changeLog) possa distinguerli e il tool
// get_human_changes restituisca solo modifiche dell'umano.

export type ElementAuthor = 'claude' | 'human';

export interface AuthoredElement {
  id?: string;
  customData?: { author?: ElementAuthor; [key: string]: any };
  [key: string]: any;
}

/** Tagga tutti gli elementi senza author come human (interazione UI). */
export function trackElementAuthor<T extends AuthoredElement>(
  elements: readonly T[],
  defaultAuthor: ElementAuthor = 'human',
): T[] {
  return elements.map((el) => {
    const existing = el.customData?.author;
    if (existing) return el;
    return {
      ...el,
      customData: { ...(el.customData || {}), author: defaultAuthor },
    };
  });
}

/** Separa gli elementi per autore, utile per styling differenziato. */
export function groupByAuthor<T extends AuthoredElement>(
  elements: readonly T[],
): { claude: T[]; human: T[] } {
  const claude: T[] = [];
  const human: T[] = [];
  for (const el of elements) {
    if (el.customData?.author === 'claude') claude.push(el);
    else human.push(el);
  }
  return { claude, human };
}
