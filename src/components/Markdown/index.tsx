import React, { Suspense } from "react";

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

// Lazy-load the heavy Streamdown renderer (shiki + mermaid + katex) so it is
// code-split out of the initial bundle and only fetched the first time markdown
// is actually rendered (i.e. when an AI response appears).
const StreamdownRenderer = React.lazy(
  () => import("./streamdown-renderer")
);

export function Markdown({
  children,
  isStreaming = false,
}: MarkdownRendererProps) {
  return (
    <Suspense
      fallback={
        // Plain-text fallback keeps streaming content visible (and layout
        // stable) during the brief lazy-chunk fetch — no blank flash.
        <div className="whitespace-pre-wrap break-words">{children}</div>
      }
    >
      <StreamdownRenderer isStreaming={isStreaming}>
        {children}
      </StreamdownRenderer>
    </Suspense>
  );
}
