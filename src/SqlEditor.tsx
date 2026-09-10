import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
  undoDepth,
  redoDepth,
  selectAll,
} from "@codemirror/commands";
import { sql, MSSQL } from "@codemirror/lang-sql";
import {
  HighlightStyle,
  syntaxHighlighting,
  bracketMatching,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { copyText } from "./clipboard";

const sqlHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c5adf0" },
  { tag: tags.string, color: "#a7d8b3" },
  { tag: tags.number, color: "#e8bb86" },
  { tag: tags.comment, color: "#8b9db3", fontStyle: "italic" },
  { tag: tags.operator, color: "#9fc9dc" },
]);

export function SqlEditor({
  value,
  onChange,
  onRun,
  onSelection,
  canRun,
  onNotice,
}: {
  value: string;
  onChange: (sql: string) => void;
  onRun: () => void;
  onSelection: (sql: string) => void;
  canRun: boolean;
  onNotice: (message: string) => void;
}) {
  const context = useContextMenu<null>();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onRun, onSelection });
  useEffect(() => {
    callbacks.current = { onChange, onRun, onSelection };
  });
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          sql({ dialect: MSSQL }),
          syntaxHighlighting(sqlHighlight),
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                callbacks.current.onRun();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.contentAttributes.of({
            "aria-label": "SQL editor",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callbacks.current.onChange(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) {
              const selection = update.state.selection.main;
              callbacks.current.onSelection(
                update.state.sliceDoc(selection.from, selection.to),
              );
            }
          }),
          EditorView.theme(
            {
              "&": {
                height: "100%",
                backgroundColor: "#111722",
                color: "#d5dceb",
              },
              ".cm-scroller": {
                overflow: "auto",
                fontFamily: "var(--mono)",
                fontSize: "13px",
              },
              ".cm-content": { padding: "16px 0" },
              ".cm-gutters": {
                backgroundColor: "#111722",
                color: "#526176",
                border: "none",
                paddingRight: "14px",
              },
              ".cm-activeLine": { backgroundColor: "#192333" },
              ".cm-activeLineGutter": { backgroundColor: "transparent" },
              "&.cm-focused": { outline: "none" },
              ".cm-cursor": { borderLeftColor: "#b4f3d0" },
              "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
                backgroundColor: "#33465e",
              },
            },
            { dark: true },
          ),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
    // The editor lives for the mounted pane; external document changes are synchronized below.
  }, []);
  useEffect(() => {
    const view = editor.current;
    if (view && value !== view.state.doc.toString())
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
  }, [value]);
  const view = editor.current;
  const selectedText = view
    ? view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      )
    : "";
  return (
    <>
      <div className="sql-editor" ref={host} {...context.bind(null)} />
      {context.menu && view && (
        <ContextMenu
          position={context.menu}
          label="SQL editor"
          onClose={context.close}
          actions={[
            {
              label: selectedText ? "Run selection" : "Run SQL",
              disabled: !canRun,
              run: onRun,
            },
            {
              label: "Undo",
              separator: true,
              disabled: undoDepth(view.state) === 0,
              run: () => {
                undo(view);
                view.focus();
              },
            },
            {
              label: "Redo",
              disabled: redoDepth(view.state) === 0,
              run: () => {
                redo(view);
                view.focus();
              },
            },
            {
              label: "Copy",
              separator: true,
              disabled: !selectedText,
              run: () => {
                void copyText(selectedText, onNotice);
                view.focus();
              },
            },
            {
              label: "Paste",
              run: () => {
                const state = view.state;
                void navigator.clipboard
                  .readText()
                  .then((text) => {
                    if (editor.current !== view || view.state !== state) {
                      onNotice(
                        "The editor changed. Paste again at the current selection.",
                      );
                      return;
                    }
                    view.dispatch(view.state.replaceSelection(text), {
                      scrollIntoView: true,
                      userEvent: "input.paste",
                    });
                    view.focus();
                  })
                  .catch((error: Error) =>
                    onNotice(`Paste failed: ${error.message}`),
                  );
              },
            },
            {
              label: "Select all",
              run: () => {
                selectAll(view);
                view.focus();
              },
            },
          ]}
        />
      )}
    </>
  );
}
