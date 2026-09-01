import { useState, useRef, useEffect } from 'react';
import { generateContextualSuggestions } from '../lib/llm';

// Contextual "next step" suggestions, refreshed whenever the active version's
// code changes. One effect covers generation, refinement, undo/redo, and
// project load/switch, since they all ultimately set `generatedCode`.
export default function useSuggestions({ generatedCode, versions, projectName, isGenerating }) {
  const [contextualSuggestions, setContextualSuggestions] = useState([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [isSuggestionsExpanded, setIsSuggestionsExpanded] = useState(false);
  const suggestionsAbortControllerRef = useRef(null);

  useEffect(() => {
    if (!generatedCode) {
      setContextualSuggestions([]);
      setIsSuggestionsLoading(false);
      return;
    }

    const controller = new AbortController();
    suggestionsAbortControllerRef.current = controller;

    // Debounced so a burst of rapid undo/redo clicks only fires one request --
    // the cleanup below cancels the pending timer/fetch on every re-run.
    const debounceId = setTimeout(() => {
      setIsSuggestionsLoading(true);
      generateContextualSuggestions({
        code: generatedCode,
        versions,
        projectName,
        signal: controller.signal
      })
        .then((result) => {
          if (!controller.signal.aborted) setContextualSuggestions(result);
        })
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setIsSuggestionsLoading(false);
        });
    }, 500);

    return () => {
      clearTimeout(debounceId);
      controller.abort();
    };
    // versions always updates alongside generatedCode at every mutation site (handleGenerate,
    // loadProjectById, loadProject, switchVersion), so the closure is never stale. projectName
    // is intentionally excluded so renaming mid-typing doesn't retrigger a fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedCode]);

  // Manual re-roll of the contextual suggestions (also called by the auto-refresh effect above).
  const handleRefreshSuggestions = () => {
    if (!generatedCode || isGenerating) return;
    setIsSuggestionsExpanded(true);
    suggestionsAbortControllerRef.current?.abort();
    const controller = new AbortController();
    suggestionsAbortControllerRef.current = controller;
    setIsSuggestionsLoading(true);
    generateContextualSuggestions({
      code: generatedCode,
      versions,
      projectName,
      signal: controller.signal
    })
      .then((result) => {
        if (!controller.signal.aborted) setContextualSuggestions(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setIsSuggestionsLoading(false);
      });
  };

  return {
    contextualSuggestions,
    isSuggestionsLoading,
    isSuggestionsExpanded,
    setIsSuggestionsExpanded,
    handleRefreshSuggestions,
  };
}
