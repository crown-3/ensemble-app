export type Segment = { text: string; mention?: string };

// Splits text into plain and @mention segments. A mention is "@" followed by one of
// the known names. Names are matched by prefix (longest first) because Korean particles
// attach directly to the name: "@서윤이 정리해 줘" mentions 서윤.
export function splitMentions(text: string, names: string[]): Segment[] {
  const sorted = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  const out: Segment[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '@' && (i === 0 || !/[\w@]/.test(text[i - 1]))) {
      const name = sorted.find((n) => text.startsWith(n, i + 1));
      if (name) {
        if (plain) out.push({ text: plain });
        plain = '';
        out.push({ text: '@' + name, mention: name });
        i += name.length + 1;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  if (plain) out.push({ text: plain });
  return out;
}

// Mentioned names in order of first appearance, without duplicates.
export function findMentions(text: string, names: string[]): string[] {
  const found: string[] = [];
  for (const s of splitMentions(text, names)) {
    if (s.mention && !found.includes(s.mention)) found.push(s.mention);
  }
  return found;
}
