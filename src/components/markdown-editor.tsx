import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Annotation, type ChangeSpec, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  placeholder as cmPlaceholder,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import * as Y from "yjs";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** If provided, enables Yjs collaborative editing */
  pageId?: string;
  /** Auth token for WebSocket */
  token?: string;
  /** Callback when viewers change */
  onViewersChange?: (viewers: string[]) => void;
  /** Callback when page becomes readonly (locked/archived) or editable again */
  onReadonlyChange?: (readonly: boolean, reason?: string) => void;
}

// Light theme matching shadcn
const lightTheme = EditorView.theme({
  "&": {
    fontSize: "14px",
    border: "1px solid hsl(var(--border))",
    borderRadius: "calc(var(--radius) - 2px)",
    backgroundColor: "hsl(var(--background))",
  },
  "&.cm-focused": {
    outline: "2px solid hsl(var(--ring))",
    outlineOffset: "-1px",
  },
  ".cm-content": {
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
    padding: "8px 0",
    minHeight: "400px",
    caretColor: "hsl(var(--foreground))",
  },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": {
    backgroundColor: "hsl(var(--muted))",
    color: "hsl(var(--muted-foreground))",
    border: "none",
    borderRight: "1px solid hsl(var(--border))",
    borderRadius: "calc(var(--radius) - 2px) 0 0 calc(var(--radius) - 2px)",
  },
  ".cm-activeLineGutter": { backgroundColor: "hsl(var(--accent))" },
  ".cm-activeLine": { backgroundColor: "hsl(var(--accent) / 0.5)" },
  ".cm-cursor": { borderLeftColor: "hsl(var(--foreground))" },
  ".cm-selectionBackground": {
    backgroundColor: "hsl(var(--accent)) !important",
  },
  ".cm-placeholder": { color: "hsl(var(--muted-foreground))" },
});

function isDark() {
  return document.documentElement.classList.contains("dark");
}

const remoteUpdate = Annotation.define<boolean>();

export function MarkdownEditor({
  value,
  onChange,
  disabled = false,
  placeholder = "Write markdown here…",
  className,
  pageId,
  token,
  onViewersChange,
  onReadonlyChange,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onChangeRef = useRef(onChange);
  const onViewersRef = useRef(onViewersChange);
  const onReadonlyRef = useRef(onReadonlyChange);
  const ydocRef = useRef<any>(null);
  const ytextRef = useRef<any>(null);
  const initializedRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  onChangeRef.current = onChange;
  onViewersRef.current = onViewersChange;
  onReadonlyRef.current = onReadonlyChange;

  // Stable refs for pageId/token
  const pageIdRef = useRef(pageId);
  const tokenRef = useRef(token);
  pageIdRef.current = pageId;
  tokenRef.current = token;

  useEffect(() => {
    if (!containerRef.current) return;

    const dark = isDark();

    // ── Yjs setup (if collaborative) ──
    let ydoc: any = null;
    let ytext: any = null;
    let ws: WebSocket | null = null;
    let ytextObserver: any = null;

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      bracketMatching(),
      indentOnInput(),
      highlightSelectionMatches(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      dark ? oneDark : lightTheme,
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      cmPlaceholder(placeholder),
      EditorView.lineWrapping,
      EditorState.readOnly.of(disabled),
    ];

    let pingInterval: ReturnType<typeof setInterval> | undefined;
    if (pageIdRef.current && tokenRef.current) {
      // Collaborative mode with Yjs
      ydoc = new Y.Doc();
      ytext = ydoc.getText("content");
      ydocRef.current = ydoc;
      ytextRef.current = ytext;

      // CM6 ↔ Yjs sync plugin (inspired by HedgeDoc's YTextSyncViewPlugin)
      const yjsSyncPlugin = ViewPlugin.define((editorView) => {
        const plugin: PluginValue & { _view: EditorView } = {
          _view: editorView,
          update(update: ViewUpdate) {
            if (!update.docChanged) return;
            // Apply CM changes to Yjs (skip if change came from Yjs)
            update.transactions
              .filter((tr) => !tr.annotation(remoteUpdate))
              .forEach((tr) => {
                ytext.doc?.transact(() => {
                  let adj = 0;
                  tr.changes.iterChanges(
                    (
                      fromA: number,
                      toA: number,
                      _fromB: number,
                      _toB: number,
                      insert: any,
                    ) => {
                      const text = insert.sliceString(0, insert.length, "\n");
                      if (fromA !== toA) ytext.delete(fromA + adj, toA - fromA);
                      if (text.length > 0) ytext.insert(fromA + adj, text);
                      adj += text.length - (toA - fromA);
                    },
                  );
                }, "codemirror");
              });
          },
          destroy() {},
        };

        // Observe Yjs changes → apply to CM
        ytextObserver = (event: any, transaction: any) => {
          if (transaction.origin === "codemirror") return;
          const changes: ChangeSpec[] = [];
          let pos = 0;
          for (const delta of event.delta) {
            if (delta.insert) {
              changes.push({ from: pos, to: pos, insert: delta.insert });
            } else if (delta.delete) {
              changes.push({ from: pos, to: pos + delta.delete });
              pos += delta.delete;
            } else if (delta.retain) {
              pos += delta.retain;
            }
          }
          if (changes.length > 0) {
            editorView.dispatch({
              changes,
              annotations: [remoteUpdate.of(true)],
            });
            onChangeRef.current(ytext.toString());
          }
        };
        ytext.observe(ytextObserver);

        return plugin;
      });

      extensions.push(yjsSyncPlugin);

      // Also report local changes
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged &&
            !update.transactions.some((tr) => tr.annotation(remoteUpdate))
          ) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      );

      // Connect WebSocket
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${window.location.host}/api/notebook/ws?page=${pageIdRef.current}&token=${tokenRef.current}`;
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "sync" && Array.isArray(msg.update)) {
            // Initial sync — replace doc content
            const update = new Uint8Array(msg.update);
            Y.applyUpdate(ydoc, update, "server");
            // Set CM content to match
            const content = ytext.toString();
            const view = viewRef.current;
            if (view) {
              const currentDoc = view.state.doc.toString();
              if (currentDoc !== content) {
                view.dispatch({
                  changes: { from: 0, to: currentDoc.length, insert: content },
                  annotations: [remoteUpdate.of(true)],
                });
              }
            }
            onChangeRef.current(content);
            initializedRef.current = true;
          } else if (msg.type === "update" && Array.isArray(msg.update)) {
            // Incremental update from another peer
            const update = new Uint8Array(msg.update);
            Y.applyUpdate(ydoc, update, "server");
          } else if (msg.type === "viewers" && Array.isArray(msg.viewers)) {
            onViewersRef.current?.(msg.viewers);
          } else if (msg.type === "readonly") {
            onReadonlyRef.current?.(true, msg.reason);
          } else if (msg.type === "editable") {
            onReadonlyRef.current?.(false);
          }
        } catch {}
      };

      // Send local Yjs updates to server
      ydoc.on("update", (update: Uint8Array, origin: any) => {
        if (origin === "server") return;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "update",
              update: Array.from(update),
            }),
          );
        }
      });

      ws.onerror = (err) => {
        console.error("[notebook:ws] connection error", err);
      };

      ws.onclose = (evt) => {
        console.log(`[notebook:ws] disconnected (code=${evt.code} reason=${evt.reason})`);
      };

      // Keep-alive ping every 30 s — Cloudflare drops idle WS after 100 s
      const pingInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30_000);
    } else {
      // Non-collaborative fallback
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      );
    }

    const view = new EditorView({
      state: EditorState.create({
        doc: pageIdRef.current ? "" : valueRef.current,
        extensions,
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      if (ytextObserver && ytext) ytext.unobserve(ytextObserver);
      clearInterval(pingInterval);
      ws?.close();
      wsRef.current = null;
      view.destroy();
      viewRef.current = null;
      if (ydoc) ydoc.destroy();
      ydocRef.current = null;
      ytextRef.current = null;
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, placeholder]);

  // For non-collaborative mode, sync external value changes
  useEffect(() => {
    if (pageIdRef.current) return; // collaborative mode handles its own sync
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        annotations: [remoteUpdate.of(true)],
      });
    }
  }, [value]);

  return (
    <div ref={containerRef} className={className} data-slot="markdown-editor" />
  );
}
