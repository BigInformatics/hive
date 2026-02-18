import { useRef, useEffect, useCallback } from "react";
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

// Light theme that matches shadcn styling
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
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-gutters": {
    backgroundColor: "hsl(var(--muted))",
    color: "hsl(var(--muted-foreground))",
    border: "none",
    borderRight: "1px solid hsl(var(--border))",
    borderRadius: "calc(var(--radius) - 2px) 0 0 calc(var(--radius) - 2px)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "hsl(var(--accent))",
  },
  ".cm-activeLine": {
    backgroundColor: "hsl(var(--accent) / 0.5)",
  },
  ".cm-cursor": {
    borderLeftColor: "hsl(var(--foreground))",
  },
  ".cm-selectionBackground": {
    backgroundColor: "hsl(var(--accent)) !important",
  },
  ".cm-placeholder": {
    color: "hsl(var(--muted-foreground))",
  },
});

// Detect dark mode
function isDark() {
  return document.documentElement.classList.contains("dark");
}

export function MarkdownEditor({
  value,
  onChange,
  disabled = false,
  placeholder = "Write markdown here…",
  className,
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Track whether changes are coming from props vs user input
  const isExternalUpdate = useRef(false);

  const createState = useCallback(
    (doc: string) => {
      const dark = isDark();
      return EditorState.create({
        doc,
        extensions: [
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
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !isExternalUpdate.current) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      });
    },
    [disabled, placeholder],
  );

  // Initialize editor
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: createState(value),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only create once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      isExternalUpdate.current = true;
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
      isExternalUpdate.current = false;
    }
  }, [value]);

  // Recreate on theme/disabled changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !containerRef.current) return;
    const doc = view.state.doc.toString();
    view.setState(createState(doc));
  }, [disabled, createState]);

  return (
    <div
      ref={containerRef}
      className={className}
      data-slot="markdown-editor"
    />
  );
}
