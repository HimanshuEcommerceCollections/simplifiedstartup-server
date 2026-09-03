import sanitizeHtml from "sanitize-html";

/**
 * Rich text from the dashboard editor is stored as HTML and rendered on the
 * public website with dangerouslySetInnerHTML — so everything the editor can't
 * produce is stripped here on save. The allowlist mirrors the editor toolbar.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "blockquote", "br", "hr", "img"],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: "noopener noreferrer" },
    }),
  },
  exclusiveFilter: (frame) => {
    // images may only reference our own upload route
    if (frame.tag === "img") {
      const src = frame.attribs.src ?? "";
      return !/\/files\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(src);
    }
    return false;
  },
};

/** Returns sanitized HTML, or null for empty/blank input. */
export function sanitizeRichText(html: string | undefined | null): string | null {
  if (!html) return null;
  const clean = sanitizeHtml(html, OPTIONS).trim();
  // an "empty" document from the editor is just empty paragraphs
  const textOnly = clean.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  return textOnly || /<img\s/.test(clean) ? clean : null;
}
