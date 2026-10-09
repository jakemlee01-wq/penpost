import { marked } from "marked";
import DOMPurify from "dompurify";

let hooked = false;

/** Render story Markdown to sanitized HTML. Only http(s) and mailto links survive. */
export function renderMarkdown(md: string): string {
  if (!hooked) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        const href = node.getAttribute("href") ?? "";
        if (!/^(https?:|mailto:)/i.test(href)) node.removeAttribute("href");
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
    hooked = true;
  }
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "a", "em", "strong", "ul", "ol", "li", "blockquote", "br", "h3", "h4"],
    ALLOWED_ATTR: ["href", "target", "rel"],
  });
}
