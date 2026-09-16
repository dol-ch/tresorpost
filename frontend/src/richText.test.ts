import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, TextSelection } from "prosemirror-state";
import { wrapIn } from "prosemirror-commands";
import { wrapInList, liftListItem } from "prosemirror-schema-list";
import { docToHTML, editorSchema } from "./richText.ts";

function apply(
  cmd: (
    state: EditorState,
    dispatch?: (tr: Parameters<EditorState["apply"]>[0]) => void,
  ) => boolean,
  state: EditorState,
): EditorState {
  let next = state;
  const ok = cmd(state, (tr) => {
    next = state.apply(tr);
  });
  assert.equal(ok, true);
  return next;
}

function filledState(text = "one"): EditorState {
  const schema = editorSchema;
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text(text)]),
  ]);
  let state = EditorState.create({ schema, doc });
  const end = state.doc.content.size;
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1, end - 1)),
  );
  return state;
}

test("ordered list wraps the paragraph as ordered_list > list_item", () => {
  let state = filledState();
  state = apply(wrapInList(editorSchema.nodes.ordered_list), state);
  const list = state.doc.child(0);
  assert.equal(list.type.name, "ordered_list");
  assert.equal(list.child(0).type.name, "list_item");
  assert.equal(docToHTML(state.doc), "<ol><li><p>one</p></li></ol>");
});

test("bullet list wraps the paragraph as bullet_list > list_item", () => {
  let state = filledState();
  state = apply(wrapInList(editorSchema.nodes.bullet_list), state);
  assert.equal(state.doc.child(0).type.name, "bullet_list");
  assert.equal(docToHTML(state.doc), "<ul><li><p>one</p></li></ul>");
});

test("blockquote wraps the paragraph and serializes to <blockquote>", () => {
  let state = filledState();
  state = apply(wrapIn(editorSchema.nodes.blockquote), state);
  assert.equal(state.doc.child(0).type.name, "blockquote");
  assert.equal(docToHTML(state.doc), "<blockquote><p>one</p></blockquote>");
});

test("liftListItem unwraps an ordered list back to a paragraph", () => {
  let state = filledState();
  state = apply(wrapInList(editorSchema.nodes.ordered_list), state);
  state = apply(liftListItem(editorSchema.nodes.list_item), state);
  assert.equal(state.doc.child(0).type.name, "paragraph");
  assert.equal(docToHTML(state.doc), "<p>one</p>");
});

test("setNodeMarkup converts a bullet list to an ordered list", () => {
  let state = filledState();
  state = apply(wrapInList(editorSchema.nodes.bullet_list), state);
  const pos = 0;
  state = state.apply(
    state.tr.setNodeMarkup(pos, editorSchema.nodes.ordered_list),
  );
  assert.equal(state.doc.child(0).type.name, "ordered_list");
  assert.equal(docToHTML(state.doc), "<ol><li><p>one</p></li></ol>");
});
