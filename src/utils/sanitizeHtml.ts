import { parse, HTMLElement, NodeType } from 'node-html-parser';

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'u', 's', 'blockquote',
  'ul', 'ol', 'li', 'h2', 'h3', 'a', 'span', 'div',
]);

const DROP_WITH_CONTENT = new Set(['script', 'style', 'head', 'iframe', 'object', 'embed', 'noscript']);

const BLOCK_BREAKS = /<\/(p|li|blockquote|h2|h3|div)>|<br\s*\/?>/gi;

function sanitizeTree(element: HTMLElement): void {
  for (const child of [...element.childNodes]) {
    if (child.nodeType === NodeType.COMMENT_NODE) {
      child.remove();
      continue;
    }
    if (!(child instanceof HTMLElement)) continue;

    sanitizeTree(child);

    const tag = child.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) {
      child.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      child.replaceWith(...child.childNodes);
      continue;
    }

    const href = child.getAttribute('href');
    const mention = child.getAttribute('data-mention');
    const adjunto = child.getAttribute('data-adjunto');
    for (const name of Object.keys(child.attributes)) child.removeAttribute(name);

    if (tag === 'a') {
      if (href === undefined || !/^https?:\/\//i.test(href)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      child.setAttribute('href', href);
    } else if (tag === 'span') {
      if (mention === undefined || !/^\d+$/.test(mention)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      child.setAttribute('data-mention', mention);
    } else if (tag === 'div') {
      // Solo se conserva el marcador de adjunto en línea (orden numérico); cualquier otro div se aplana.
      if (adjunto === undefined || !/^\d{1,9}$/.test(adjunto)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      child.setAttribute('data-adjunto', adjunto);
    }
  }
}

export function sanitizeInformeHtml(html: string): string {
  const root = parse(html);
  sanitizeTree(root);
  return root.toString();
}

/** Ids únicos de los `span[data-mention]` del HTML ya sanitizado, sin el propio autor. */
export function extraerMenciones(html: string, autorId: number): number[] {
  const ids = new Set<number>();
  for (const span of parse(html).querySelectorAll('span[data-mention]')) {
    const id = Number(span.getAttribute('data-mention'));
    if (Number.isFinite(id)) ids.add(id);
  }
  ids.delete(autorId);
  return [...ids];
}

/** Texto plano con un salto de línea entre bloques. */
export function textoPlano(html: string): string {
  return parse(html.replace(BLOCK_BREAKS, '$&\n'))
    .text.split('\n')
    .map((linea) => linea.trim())
    .filter(Boolean)
    .join('\n');
}
