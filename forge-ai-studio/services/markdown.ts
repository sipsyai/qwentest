// Markdown renderer + Think tag parser (no external dependencies)

/**
 * Parse <think>...</think> tags from model output.
 * Streaming-safe: handles partial/unclosed tags.
 */
export const parseThinkTags = (raw: string): { thinking: string | null; content: string } => {
  if (!raw) return { thinking: null, content: '' };

  const openTag = '<think>';
  const closeTag = '</think>';

  const openIdx = raw.indexOf(openTag);
  if (openIdx === -1) return { thinking: null, content: raw };

  const closeIdx = raw.indexOf(closeTag, openIdx);

  if (closeIdx === -1) {
    // Partial/streaming: tag opened but not yet closed
    const thinking = raw.slice(openIdx + openTag.length);
    const before = raw.slice(0, openIdx).trim();
    return { thinking: thinking || null, content: before };
  }

  const thinking = raw.slice(openIdx + openTag.length, closeIdx).trim();
  const before = raw.slice(0, openIdx);
  const after = raw.slice(closeIdx + closeTag.length);
  const content = (before + after).trim();

  return { thinking: thinking || null, content };
};

/**
 * Lightweight markdown to HTML renderer.
 * Handles: bold, italic, inline code, code blocks, headings, lists, blockquotes, links, line breaks.
 * HTML entities are escaped BEFORE markdown transforms (XSS protection).
 */
export const renderMarkdownToHTML = (text: string): string => {
  if (!text) return '';

  // 1. Escape HTML entities first (XSS protection)
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // 2. Code blocks (``` ... ```) - must be before inline transforms
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    return `<pre class="bg-slate-900 border border-slate-700 rounded-lg p-4 my-3 overflow-x-auto"><code class="text-sm font-mono text-emerald-400">${code.trim()}</code></pre>`;
  });

  // 3. Inline code (` ... `)
  html = html.replace(/`([^`]+)`/g, '<code class="bg-slate-800 text-blue-300 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>');

  // 4. Headings (### ... , ## ... , # ...)
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-base font-bold text-white mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-white mt-4 mb-2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-white mt-4 mb-2">$1</h1>');

  // 5. Bold + Italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em class="italic">$1</em>');

  // 6. Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="border-l-2 border-slate-600 pl-4 text-slate-400 italic my-2">$1</blockquote>');

  // 7. Unordered lists
  html = html.replace(/^[\-\*] (.+)$/gm, '<li class="ml-4 list-disc text-slate-300">$1</li>');
  html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="my-2 space-y-1">$1</ul>');

  // 8. Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-slate-300">$1</li>');

  // 9. Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline hover:text-blue-300">$1</a>');

  // 10. Line breaks (double newline = paragraph break)
  html = html.replace(/\n\n/g, '</p><p class="mb-3">');
  html = html.replace(/\n/g, '<br/>');

  // Wrap in paragraph
  html = `<p class="mb-3">${html}</p>`;

  // Clean up empty paragraphs
  html = html.replace(/<p class="mb-3"><\/p>/g, '');

  return html;
};
