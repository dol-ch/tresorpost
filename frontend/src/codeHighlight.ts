// Live syntax highlighting for ProseMirror `code_block` nodes.
//
// lowlight returns a hast tree whose concatenated text exactly matches the code
// block's text, so we can walk it while tracking the character offset and emit
// inline decorations (hljs-* classes) at the right positions. Highlighting is
// purely a view concern — it never changes the stored document/HTML.

import { Plugin } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { Decoration, DecorationSet } from "prosemirror-view";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

type HastNode = {
  type: string;
  value?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
};

function walk(
  node: HastNode,
  from: number,
  decorations: Decoration[],
  classes: string[],
): number {
  if (node.type === "text") {
    const len = node.value?.length ?? 0;
    if (len > 0 && classes.length > 0) {
      decorations.push(
        Decoration.inline(from, from + len, { class: classes.join(" ") }),
      );
    }
    return from + len;
  }
  const nextClasses =
    node.properties?.className && node.properties.className.length
      ? classes.concat(node.properties.className)
      : classes;
  let pos = from;
  for (const child of node.children ?? []) {
    pos = walk(child, pos, decorations, nextClasses);
  }
  return pos;
}

function buildDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "code_block") return;
    const text = node.textContent;
    if (!text) return;
    let tree: HastNode;
    try {
      tree = lowlight.highlightAuto(text) as unknown as HastNode;
    } catch {
      return;
    }
    // +1: the first position inside the code_block's content.
    walk(tree, pos + 1, decorations, []);
  });
  return DecorationSet.create(doc, decorations);
}

export function codeHighlightPlugin(): Plugin {
  return new Plugin({
    state: {
      init: (_config, { doc }) => buildDecorations(doc),
      apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}
