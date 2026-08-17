/**
 * Minimal allowlist HTML sanitizer for provider instructions.
 *
 * Provider HTML is untrusted: we strip scripts/styles/iframes, drop event
 * handlers and style attributes, and only allow a small set of formatting tags
 * with safe attributes. The result is safe to render with `dangerouslySetInnerHTML`.
 */

const ALLOWED_TAGS = new Set([
  "p", "br", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "strong", "b", "em", "i", "u",
  "blockquote", "code", "pre", "hr", "span", "div",
  "table", "thead", "tbody", "tr", "th", "td",
  "a", "img",
]);

const STRIP_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "form", "input", "button",
  "svg", "link", "meta", "base",
]);

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "title"],
  img: ["src", "alt", "title"],
};

function safeHref(value: string): string | null {
  const v = value.trim();
  if (/^https?:\/\//i.test(v) || v.startsWith("/") || v.startsWith("#")) {
    return v;
  }
  return null;
}

function safeSrc(value: string): string | null {
  const v = value.trim();
  if (/^https?:\/\//i.test(v) || v.startsWith("/")) return v;
  return null;
}

export function sanitizeInstructionsHtml(html: string | null | undefined): string {
  if (!html) return "";
  const input = String(html);

  // Fast path: if there is no markup at all, escape and return.
  if (!/[<>]/.test(input)) {
    return escapeText(input);
  }

  let output = "";
  let i = 0;
  const len = input.length;

  while (i < len) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      output += escapeText(input.slice(i));
      break;
    }
    output += escapeText(input.slice(i, lt));

    const gt = input.indexOf(">", lt);
    if (gt === -1) {
      // Unclosed tag — escape the remainder.
      output += escapeText(input.slice(lt));
      break;
    }

    const raw = input.slice(lt, gt + 1);
    i = gt + 1;

    // Comment or processing instruction.
    if (raw.startsWith("<!--") || raw.startsWith("<!")) continue;

    const closing = raw.startsWith("</");
    const body = closing ? raw.slice(2, -1) : raw.slice(1, -1);
    const spaceIdx = body.search(/\s/);
    const tagName = (spaceIdx === -1 ? body : body.slice(0, spaceIdx)).toLowerCase();

    if (!tagName) {
      output += escapeText(raw);
      continue;
    }

    if (STRIP_TAGS.has(tagName)) continue;

    if (closing) {
      if (ALLOWED_TAGS.has(tagName)) output += `</${tagName}>`;
      continue;
    }

    const selfClosing = raw.endsWith("/>");
    if (!ALLOWED_TAGS.has(tagName)) {
      output += escapeText(raw);
      continue;
    }

    // Parse attributes into a safe subset.
    const attrs = parseAttributes(spaceIdx === -1 ? "" : body.slice(spaceIdx));
    const allowed = ALLOWED_ATTRIBUTES[tagName] ?? [];
    const safeAttrs: string[] = [];
    for (const [name, value] of attrs) {
      const key = name.toLowerCase();
      if (key.startsWith("on")) continue;
      if (!allowed.includes(key)) continue;
      if (key === "href") {
        const href = safeHref(value);
        if (href) safeAttrs.push(`href="${escapeAttr(href)}"`);
      } else if (key === "src") {
        const src = safeSrc(value);
        if (src) safeAttrs.push(`src="${escapeAttr(src)}"`);
      } else {
        safeAttrs.push(`${key}="${escapeAttr(value)}"`);
      }
    }

    const attrString = safeAttrs.length ? ` ${safeAttrs.join(" ")}` : "";
    if (tagName === "br" || tagName === "hr" || tagName === "img") {
      output += `<${tagName}${attrString}>`;
    } else if (selfClosing) {
      output += `<${tagName}${attrString}>`;
    } else {
      output += `<${tagName}${attrString}>`;
    }
  }

  return output;
}

function parseAttributes(attrString: string): [string, string][] {
  const attrs: [string, string][] = [];
  const re = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrString)) !== null) {
    const name = m[1];
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    attrs.push([name, value]);
  }
  return attrs;
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
