import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
} from "react";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Schema, DOMSerializer } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { exampleSetup } from "prosemirror-example-setup";
import { EditorToolbar } from "./EditorToolbar";
import { codeHighlightPlugin } from "./codeHighlight";

import "prosemirror-view/style/prosemirror.css";
import "./highlight.css";

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
  const [view, setView] = useState<EditorView | null>(null);
  // Bumped on every transaction so the toolbar re-computes active/enabled state.
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      schema: editorSchema,
      plugins: [
        ...exampleSetup({ schema: editorSchema, menuBar: false }),
        codeHighlightPlugin(),
      ],
    });
    const v: EditorView = new EditorView(hostRef.current, {
      state,
      dispatchTransaction(tr) {
        v.updateState(v.state.apply(tr));
        forceRender();
      },
    });
    viewRef.current = v;
    setView(v);
    return () => {
      v.destroy();
      viewRef.current = null;
      setView(null);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    getHTML: () => {
      const v = viewRef.current;
      if (!v) return "";
      const serializer = DOMSerializer.fromSchema(editorSchema);
      const fragment = serializer.serializeFragment(v.state.doc.content);
      const div = document.createElement("div");
      div.appendChild(fragment);
      return div.innerHTML;
    },
    isEmpty: () => {
      const v = viewRef.current;
      if (!v) return true;
      const doc = v.state.doc;
      return doc.childCount === 1 && doc.firstChild?.content.size === 0;
    },
  }));

  return (
    <div className="pm-editor">
      {view && <EditorToolbar view={view} />}
      <div className="editor-host" ref={hostRef} />
    </div>
  );
});

RichTextEditor.displayName = "RichTextEditor";
