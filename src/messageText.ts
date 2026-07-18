// src/messageText.ts

/** Convert Teams message HTML to plain text suitable for a Jira description. */
export function htmlToText(html: string): string {
  let s = html;
  // line-breaking elements → newline
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n');
  // all remaining tags
  s = s.replace(/<[^>]+>/g, '');
  // entities (order matters: &amp; last would double-decode if first)
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  // normalize whitespace
  s = s
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
  s = s.replace(/\n{2,}/g, '\n');
  return s.trim();
}
