export const CONCEPT_HANDOFF_KEY = "aces-concept-images";

export type ConceptHandoff = {
  urls: string[];
  skipPreprocessing: boolean;
  taskId: string;
  taskToken: string;
};

export function saveConceptHandoff(handoff: ConceptHandoff) {
  sessionStorage.setItem(CONCEPT_HANDOFF_KEY, JSON.stringify(handoff));
}

export function takeConceptHandoff(): ConceptHandoff | null {
  const raw = sessionStorage.getItem(CONCEPT_HANDOFF_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(CONCEPT_HANDOFF_KEY);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("urls" in parsed) ||
      !Array.isArray(parsed.urls) ||
      parsed.urls.some((url) => typeof url !== "string") ||
      !("skipPreprocessing" in parsed) ||
      typeof parsed.skipPreprocessing !== "boolean" ||
      !("taskId" in parsed) ||
      typeof parsed.taskId !== "string" ||
      !("taskToken" in parsed) ||
      typeof parsed.taskToken !== "string"
    ) {
      return null;
    }
    return {
      urls: parsed.urls.slice(0, 4),
      skipPreprocessing: parsed.skipPreprocessing,
      taskId: parsed.taskId,
      taskToken: parsed.taskToken,
    };
  } catch {
    return null;
  }
}
