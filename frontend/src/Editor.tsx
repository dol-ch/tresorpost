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
import { exampleSetup } from "prosemirror-example-setup";
import { EditorToolbar } from "./EditorToolbar";
import { codeHighlightPlugin } from "./codeHighlight";
import { editorSchema, docToHTML } from "./richText";

import "prosemirror-view/style/prosemirror.css";
import "./highlight.css";

export interface EditorHandle {
  getHTML: () => string;
  isEmpty: () => boolean;
  focus: () => void;
}

function docIsEmpty(doc: EditorState["doc"]): boolean {
  return doc.childCount === 1 && doc.firstChild?.content.size === 0;
}

export const RichTextEditor = forwardRef<
  EditorHandle,
  {
    autoFocus?: boolean;
    onEmptyChange?: (empty: boolean) => void;
    onBlurAway?: () => void;
    placeholder?: string;
  }
>(({ autoFocus, onEmptyChange, onBlurAway, placeholder }, ref) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onEmptyChangeRef = useRef(onEmptyChange);
  onEmptyChangeRef.current = onEmptyChange;
  const onBlurAwayRef = useRef(onBlurAway);
  onBlurAwayRef.current = onBlurAway;
  const [view, setView] = useState<EditorView | null>(null);
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
        const empty = docIsEmpty(v.state.doc);
        v.dom.classList.toggle("is-empty", empty);
        onEmptyChangeRef.current?.(empty);
        forceRender();
      },
      handleDrop(_view, event) {
        if (event.dataTransfer?.files?.length) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        blur(_view, event) {
          const next = event.relatedTarget as Node | null;
          if (next && wrapRef.current?.contains(next)) return false;
          onBlurAwayRef.current?.();
          return false;
        },
        dragover(_view, event) {
          if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
            return false;
          }
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
          return true;
        },
        drop(_view, event) {
          if (!event.dataTransfer?.files?.length) return false;
          event.preventDefault();
          return true;
        },
      },
    });
    v.dom.classList.add("is-empty");
    if (placeholder) v.dom.setAttribute("data-placeholder", placeholder);
    onEmptyChangeRef.current?.(true);
    viewRef.current = v;
    setView(v);
    if (autoFocus) v.focus();
    return () => {
      v.destroy();
      viewRef.current = null;
      setView(null);
    };
  }, []);

  useEffect(() => {
    const el = viewRef.current?.dom;
    if (el && placeholder) el.setAttribute("data-placeholder", placeholder);
  }, [placeholder, view]);

  useImperativeHandle(ref, () => ({
    getHTML: () => {
      const v = viewRef.current;
      if (!v) return "";
      return docToHTML(v.state.doc);
    },
    isEmpty: () => {
      const v = viewRef.current;
      if (!v) return true;
      return docIsEmpty(v.state.doc);
    },
    focus: () => {
      viewRef.current?.focus();
    },
  }));

  return (
    <div ref={wrapRef} className="min-w-0">
      <div className="editor-host min-w-0" ref={hostRef} />
      {view && <EditorToolbar view={view} />}
    </div>
  );
});

RichTextEditor.displayName = "RichTextEditor";
