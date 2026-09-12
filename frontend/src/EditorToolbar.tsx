import type { ReactNode } from "react";
import type { Command, EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { MarkType, NodeType } from "prosemirror-model";
import { toggleMark, setBlockType, wrapIn } from "prosemirror-commands";
import { wrapInList } from "prosemirror-schema-list";
import { undo, redo } from "prosemirror-history";

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

interface Item {
  key: string;
  title: string;
  content: ReactNode;
  active?: boolean;
  enabled: boolean;
  onRun: () => void;
}

// ── icons (feather-style, inherit currentColor) ────────────────────────────
const I = {
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
    const href = window.prompt("Link URL (https://…)");
    if (!href) return;
    run(view, toggleMark(link, { href }));
  };

  const toggleHeading = (level: number) => {
    const active = blockActive(state, heading, { level });
    run(view, active ? setBlockType(paragraph) : setBlockType(heading, { level }));
  };

  const markBtn = (
    key: string,
    title: string,
    type: MarkType,
    content: ReactNode,
  ): Item => ({
    key,
    title,
    content,
    active: markActive(state, type),
    enabled: canRun(view, toggleMark(type)),
    onRun: () => run(view, toggleMark(type)),
  });

  const groups: Item[][] = [
    [
      markBtn("bold", "Bold  (⌘/Ctrl+B)", strong, <Svg>{I.bold}</Svg>),
      markBtn("italic", "Italic  (⌘/Ctrl+I)", em, <Svg>{I.italic}</Svg>),
      markBtn("code", "Inline code", codeMark, <Svg>{I.code}</Svg>),
      {
        key: "link",
        title: "Link",
        content: <Svg>{I.link}</Svg>,
        active: markActive(state, link),
        enabled: true,
        onRun: toggleLink,
      },
    ],
    [
      {
        key: "h1",
        title: "Heading 1",
        content: <span className="pm-txt">H1</span>,
        active: blockActive(state, heading, { level: 1 }),
        enabled: true,
        onRun: () => toggleHeading(1),
      },
      {
        key: "h2",
        title: "Heading 2",
        content: <span className="pm-txt">H2</span>,
        active: blockActive(state, heading, { level: 2 }),
        enabled: true,
        onRun: () => toggleHeading(2),
      },
    ],
    [
      {
        key: "bullet",
        title: "Bullet list",
        content: <Svg>{I.list}</Svg>,
        active: wrappedIn(state, bullet),
        enabled: canRun(view, wrapInList(bullet)) || wrappedIn(state, bullet),
        onRun: () => run(view, wrapInList(bullet)),
      },
      {
        key: "ordered",
        title: "Numbered list",
        content: <Svg>{I.listOrdered}</Svg>,
        active: wrappedIn(state, ordered),
        enabled: canRun(view, wrapInList(ordered)) || wrappedIn(state, ordered),
        onRun: () => run(view, wrapInList(ordered)),
      },
      {
        key: "quote",
        title: "Quote",
        content: <Svg>{I.quote}</Svg>,
        active: wrappedIn(state, quote),
        enabled: canRun(view, wrapIn(quote)),
        onRun: () => run(view, wrapIn(quote)),
      },
      {
        key: "hr",
        title: "Divider",
        content: <Svg>{I.rule}</Svg>,
        enabled: true,
        onRun: () => run(view, insertHr),
      },
    ],
    [
      {
        key: "undo",
        title: "Undo  (⌘/Ctrl+Z)",
        content: <Svg>{I.undo}</Svg>,
        enabled: canRun(view, undo),
        onRun: () => run(view, undo),
      },
      {
        key: "redo",
        title: "Redo  (⌘/Ctrl+Y)",
        content: <Svg>{I.redo}</Svg>,
        enabled: canRun(view, redo),
        onRun: () => run(view, redo),
      },
    ],
  ];

  return (
    <div className="pm-toolbar" role="toolbar" aria-label="Formatting">
      {groups.map((group, gi) => (
        <div className="pm-group" key={gi}>
          {gi > 0 && <span className="pm-divider" aria-hidden="true" />}
          {group.map((it) => (
            <button
              key={it.key}
              type="button"
              className={`pm-btn${it.active ? " is-active" : ""}`}
              title={it.title}
              aria-label={it.title}
              aria-pressed={it.active ? true : undefined}
              disabled={!it.enabled}
              // Keep the editor selection while clicking a toolbar button.
              onMouseDown={(e) => e.preventDefault()}
              onClick={it.onRun}
            >
              {it.content}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
