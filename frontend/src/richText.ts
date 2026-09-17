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

function escapeMd(text: string): string {
  return text.replace(/([\\`*_[\]#])/g, "\\$1");
}

function inlineMarkdown(node: PMNode): string {
  if (node.type.name === "hard_break") return "  \n";
  if (node.isText) {
    const names = new Set(node.marks.map((m) => m.type.name));
    let out = node.text ?? "";
    if (names.has("code")) {
      out = "`" + out.replace(/`/g, "\\`") + "`";
    } else {
      out = escapeMd(out);
      if (names.has("strong")) out = `**${out}**`;
      if (names.has("em")) out = `*${out}*`;
      const link = node.marks.find((m) => m.type.name === "link");
      if (link?.attrs.href) out = `[${out}](${link.attrs.href})`;
    }
    return out;
  }
  let inner = "";
  node.forEach((child) => {
    inner += inlineMarkdown(child);
  });
  return inner;
}

function indentBlock(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? prefix + line : "  " + line))
    .join("\n");
}

function blockMarkdown(node: PMNode): string {
  switch (node.type.name) {
    case "paragraph":
      return inlineMarkdown(node);
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs.level) || 1));
      return `${"#".repeat(level)} ${inlineMarkdown(node)}`;
    }
    case "code_block":
      return "```\n" + node.textContent + "\n```";
    case "blockquote": {
      const inner = blocksMarkdown(node);
      return inner
        .split("\n")
        .map((line) => (line.length ? `> ${line}` : ">"))
        .join("\n");
    }
    case "horizontal_rule":
      return "---";
    case "bullet_list": {
      const items: string[] = [];
      node.forEach((item) => {
        items.push(indentBlock(blocksMarkdown(item), "- "));
      });
      return items.join("\n");
    }
    case "ordered_list": {
      let i = Number(node.attrs.order) || 1;
      const items: string[] = [];
      node.forEach((item) => {
        items.push(indentBlock(blocksMarkdown(item), `${i}. `));
        i += 1;
      });
      return items.join("\n");
    }
    case "list_item":
      return blocksMarkdown(node);
    default:
      return node.isLeaf ? "" : blocksMarkdown(node);
  }
}

function blocksMarkdown(parent: PMNode): string {
  const parts: string[] = [];
  parent.forEach((child) => {
    const chunk = blockMarkdown(child);
    if (chunk) parts.push(chunk);
  });
  const tight = parent.type.name === "list_item";
  return parts.join(tight ? "\n" : "\n\n");
}

/** Schema-faithful Markdown for downloading a decrypted text note. */
export function docToMarkdown(doc: PMNode): string {
  const md = blocksMarkdown(doc).trim();
  return md ? md + "\n" : "";
}

export const TEXT_NOTE_MARKDOWN_FILENAME = "tresorpost-note.md";

/** Convert stored rich-text HTML to Markdown. Needs a DOM (decrypt view). */
export function htmlToMarkdown(html: string): string {
  if (typeof document === "undefined") return "";
  try {
    return docToMarkdown(htmlToDoc(html));
  } catch {
    return "";
  }
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
