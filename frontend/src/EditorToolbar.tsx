import type { ReactNode } from "react";
import { toggleMark, setBlockType, wrapIn, lift } from "prosemirror-commands";
import { undo, redo } from "prosemirror-history";
import type { MarkType, NodeType } from "prosemirror-model";
import { wrapInList, liftListItem } from "prosemirror-schema-list";
import type { Command, EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { useT } from "./i18n";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

function blockActive(
  state: EditorState,
  type: NodeType,
  attrs: Record<string, unknown> = {},
): boolean {
  const { $from, to } = state.selection;
  return to <= $from.end() && $from.parent.hasMarkup(type, attrs);
}

// True when the selection is anywhere inside a node of the given type
// (e.g. within a list or a blockquote, which wrap other blocks).
function wrappedIn(state: EditorState, type: NodeType): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === type) return true;
  }
  return false;
}

function canRun(view: EditorView, cmd: Command): boolean {
  return cmd(view.state, undefined, view);
}

function run(view: EditorView, cmd: Command) {
  cmd(view.state, view.dispatch, view);
  view.focus();
}

interface ToolbarItem {
  key: string;
  title: string;
  content: ReactNode;
  active?: boolean;
  enabled: boolean;
  onRun: () => void;
}

// ── icons (feather-style, inherit currentColor) ────────────────────────────
const I: Record<string, ReactNode> = {
  bold: (
    <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
  ),
  italic: (
    <>
      <line x1="19" y1="5" x2="11" y2="5" />
      <line x1="13" y1="19" x2="5" y2="19" />
      <line x1="15" y1="5" x2="9" y2="19" />
    </>
  ),
  code: (
    <>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  list: (
    <>
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1.2" />
      <circle cx="4.5" cy="12" r="1.2" />
      <circle cx="4.5" cy="18" r="1.2" />
    </>
  ),
  listOrdered: (
    <>
      <line x1="10" y1="6" x2="20" y2="6" />
      <line x1="10" y1="12" x2="20" y2="12" />
      <line x1="10" y1="18" x2="20" y2="18" />
      <path d="M4 8V4l-1 1" strokeWidth="1.6" />
      <path d="M3 14h2l-2 3h2" strokeWidth="1.6" />
    </>
  ),
  quote: (
    <path d="M7 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h2v1a2 2 0 0 1-2 2M17 7h-3a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h2v1a2 2 0 0 1-2 2" />
  ),
  rule: <line x1="4" y1="12" x2="20" y2="12" />,
  undo: (
    <>
      <path d="M9 7L4 12l5 5" />
      <path d="M4 12h11a5 5 0 0 1 0 10h-1" />
    </>
  ),
  redo: (
    <>
      <path d="M15 7l5 5-5 5" />
      <path d="M20 12H9a5 5 0 0 0 0 10h1" />
    </>
  ),
};

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function EditorToolbar({ view }: { view: EditorView }) {
  const t = useT();
  const { state } = view;
  const { schema } = state;
  const strong = schema.marks.strong;
  const em = schema.marks.em;
  const codeMark = schema.marks.code;
  const link = schema.marks.link;
  const heading = schema.nodes.heading;
  const paragraph = schema.nodes.paragraph;
  const bullet = schema.nodes.bullet_list;
  const ordered = schema.nodes.ordered_list;
  const quote = schema.nodes.blockquote;
  const hr = schema.nodes.horizontal_rule;

  const insertHr: Command = (s, dispatch) => {
    if (dispatch) dispatch(s.tr.replaceSelectionWith(hr.create()).scrollIntoView());
    return true;
  };

  const toggleLink = () => {
    if (markActive(state, link)) {
      run(view, toggleMark(link));
      return;
    }
    const href = window.prompt(t("editor.linkPrompt"));
    if (!href) return;
    run(view, toggleMark(link, { href }));
  };

  const toggleHeading = (level: number) => {
    const active = blockActive(state, heading, { level });
    run(view, active ? setBlockType(paragraph) : setBlockType(heading, { level }));
  };

  const toggleList = (listType: NodeType) => {
    const item = schema.nodes.list_item;
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type === listType) {
        run(view, liftListItem(item));
        return;
      }
      if (node.type === bullet || node.type === ordered) {
        const convert: Command = (s, dispatch) => {
          if (dispatch) dispatch(s.tr.setNodeMarkup($from.before(d), listType));
          return true;
        };
        run(view, convert);
        return;
      }
    }
    run(view, wrapInList(listType));
  };

  const toggleQuote = () => {
    if (wrappedIn(state, quote)) {
      run(view, lift);
      return;
    }
    run(view, wrapIn(quote));
  };

  const markBtn = (
    key: string,
    title: string,
    type: MarkType,
    content: ReactNode,
  ): ToolbarItem => ({
    key,
    title,
    content,
    active: markActive(state, type),
    enabled: canRun(view, toggleMark(type)),
    onRun: () => run(view, toggleMark(type)),
  });

  const groups: ToolbarItem[][] = [
    [
      markBtn("bold", t("editor.bold"), strong, <Svg>{I.bold}</Svg>),
      markBtn("italic", t("editor.italic"), em, <Svg>{I.italic}</Svg>),
      markBtn("code", t("editor.code"), codeMark, <Svg>{I.code}</Svg>),
      {
        key: "link",
        title: t("editor.link"),
        content: <Svg>{I.link}</Svg>,
        active: markActive(state, link),
        enabled: true,
        onRun: toggleLink,
      },
    ],
    [
      {
        key: "h1",
        title: t("editor.h1"),
        content: <span className="text-[10px] font-semibold">H1</span>,
        active: blockActive(state, heading, { level: 1 }),
        enabled: true,
        onRun: () => toggleHeading(1),
      },
      {
        key: "h2",
        title: t("editor.h2"),
        content: <span className="text-[10px] font-semibold">H2</span>,
        active: blockActive(state, heading, { level: 2 }),
        enabled: true,
        onRun: () => toggleHeading(2),
      },
    ],
    [
      {
        key: "bullet",
        title: t("editor.bullet"),
        content: <Svg>{I.list}</Svg>,
        active: wrappedIn(state, bullet),
        enabled: canRun(view, wrapInList(bullet)) || wrappedIn(state, bullet) || wrappedIn(state, ordered),
        onRun: () => toggleList(bullet),
      },
      {
        key: "ordered",
        title: t("editor.ordered"),
        content: <Svg>{I.listOrdered}</Svg>,
        active: wrappedIn(state, ordered),
        enabled: canRun(view, wrapInList(ordered)) || wrappedIn(state, ordered) || wrappedIn(state, bullet),
        onRun: () => toggleList(ordered),
      },
      {
        key: "quote",
        title: t("editor.quote"),
        content: <Svg>{I.quote}</Svg>,
        active: wrappedIn(state, quote),
        enabled: canRun(view, wrapIn(quote)) || wrappedIn(state, quote),
        onRun: () => toggleQuote(),
      },
      {
        key: "hr",
        title: t("editor.hr"),
        content: <Svg>{I.rule}</Svg>,
        enabled: true,
        onRun: () => run(view, insertHr),
      },
    ],
    [
      {
        key: "undo",
        title: t("editor.undo"),
        content: <Svg>{I.undo}</Svg>,
        enabled: canRun(view, undo),
        onRun: () => run(view, undo),
      },
      {
        key: "redo",
        title: t("editor.redo"),
        content: <Svg>{I.redo}</Svg>,
        enabled: canRun(view, redo),
        onRun: () => run(view, redo),
      },
    ],
  ];

  return (
    <div
      className="flex items-center gap-0.5 overflow-x-auto border-t border-border bg-card px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="toolbar"
      aria-label={t("editor.formatting")}
    >
      {groups.map((group, gi) => (
        <div className="flex items-center gap-0.5" key={gi}>
          {gi > 0 && <Separator orientation="vertical" className="mx-1 h-4 bg-border" />}
          {group.map((it) => (
            <Button
              key={it.key}
              type="button"
              size="icon-xs"
              variant="ghost"
              className={cn(
                "size-8 rounded-[8px] text-muted-foreground hover:bg-muted hover:text-foreground",
                it.active && "bg-muted text-foreground",
              )}
              title={it.title}
              aria-label={it.title}
              aria-pressed={it.active ? true : undefined}
              disabled={!it.enabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={it.onRun}
            >
              {it.content}
            </Button>
          ))}
        </div>
      ))}
    </div>
  );
}
