import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Schema, DOMSerializer } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { exampleSetup } from "prosemirror-example-setup";

import "prosemirror-view/style/prosemirror.css";
import "prosemirror-menu/style/menu.css";
import "prosemirror-example-setup/style/style.css";

const editorSchema = new Schema({
  nodes: addListNodes(basicSchema.spec.nodes, "paragraph block*", "block"),
  marks: basicSchema.spec.marks,
});

export interface EditorHandle {
  getHTML: () => string;
  isEmpty: () => boolean;
}

export const RichTextEditor = forwardRef<EditorHandle>((_props, ref) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      schema: editorSchema,
      plugins: exampleSetup({ schema: editorSchema, menuBar: true }),
    });
    const view = new EditorView(hostRef.current, { state });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    getHTML: () => {
      const view = viewRef.current;
      if (!view) return "";
      const serializer = DOMSerializer.fromSchema(editorSchema);
      const fragment = serializer.serializeFragment(view.state.doc.content);
      const div = document.createElement("div");
      div.appendChild(fragment);
      return div.innerHTML;
    },
    isEmpty: () => {
      const view = viewRef.current;
      if (!view) return true;
      const doc = view.state.doc;
      return doc.childCount === 1 && doc.firstChild?.content.size === 0;
    },
  }));

  return <div className="editor-host" ref={hostRef} />;
});

RichTextEditor.displayName = "RichTextEditor";
