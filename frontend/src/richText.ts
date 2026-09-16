import {
  Schema,
  DOMParser as PMDOMParser,
  type Mark,
  type Node as PMNode,
} from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";

export const editorSchema = new Schema({
  nodes: addListNodes(basicSchema.spec.nodes, "paragraph block*", "block"),
  marks: basicSchema.spec.marks,
});

const VOID_TAGS = new Set(["hr", "br", "img"]);

/** Tags the decrypt view must keep. Matches the editor schema. */
export const RICH_TEXT_SANITIZE = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "blockquote",
    "ol",
    "ul",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "pre",
    "code",
    "hr",
    "strong",
    "b",
    "em",
    "i",
    "a",
  ],
  ALLOWED_ATTR: ["href", "start", "reversed"],
  ALLOW_DATA_ATTR: false,
} as const;

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00a0/g, "&nbsp;");
}

function attrString(attrs: Record<string, unknown> | null): string {
  if (!attrs) return "";
  let out = "";
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    out += ` ${key}="${escapeText(String(value)).replace(/"/g, "&quot;")}"`;
  }
  return out;
}

function specHasHole(spec: unknown): boolean {
  if (spec === 0) return true;
  if (!Array.isArray(spec)) return false;
  return spec.some((piece) => specHasHole(piece));
}

function applySpec(spec: unknown, inner: string): string {
  if (typeof spec === "string") return spec;
  if (!Array.isArray(spec) || spec.length === 0) return inner;
  const tag = String(spec[0]);
  let i = 1;
  let attrs: Record<string, unknown> | null = null;
  if (
    spec[1] != null &&
    typeof spec[1] === "object" &&
    !Array.isArray(spec[1])
  ) {
    attrs = spec[1] as Record<string, unknown>;
    i = 2;
  }
  let body = "";
  for (; i < spec.length; i++) {
    const piece = spec[i];
    if (piece === 0) body += inner;
    else body += applySpec(piece, inner);
  }
  if (VOID_TAGS.has(tag)) return `<${tag}${attrString(attrs)}>`;
  if (!specHasHole(spec)) body = inner + body;
  return `<${tag}${attrString(attrs)}>${body}</${tag}>`;
}

function wrapMarks(html: string, marks: readonly Mark[]): string {
  let out = html;
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];
    const spec = mark.type.spec.toDOM?.(mark, true);
    out = spec ? applySpec(spec, out) : out;
  }
  return out;
}

function nodeToHTML(node: PMNode): string {
  if (node.isText) {
    return wrapMarks(escapeText(node.text ?? ""), node.marks);
  }
  let inner = "";
  node.forEach((child) => {
    inner += nodeToHTML(child);
  });
  const spec = node.type.spec.toDOM?.(node);
  if (!spec) return inner;
  return applySpec(spec, inner);
}

/** Schema-faithful HTML for encrypt / decrypt. Does not need a browser DOM. */
export function docToHTML(doc: PMNode): string {
  let html = "";
  doc.forEach((child) => {
    html += nodeToHTML(child);
  });
  return html;
}

export function htmlToDoc(html: string): PMNode {
  const parser = PMDOMParser.fromSchema(editorSchema);
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  return parser.parse(wrap);
}

/** Re-parse HTML through the editor schema so lists and quotes stay canonical. */
export function displayHTML(html: string): string {
  if (typeof document === "undefined") return html;
  try {
    return docToHTML(htmlToDoc(html));
  } catch {
    return html;
  }
}
