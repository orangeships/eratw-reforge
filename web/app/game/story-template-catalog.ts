import bundle from "./story-templates.bundle.json";
import type { StoryTemplateDocumentV2 } from "../../../modernization/runtime/story/types.js";
import { isStoryTemplateDocumentV2 } from "../../../modernization/runtime/story/template-document.js";

interface StoryTemplateBundleV2 {
  version: 2;
  templates: StoryTemplateDocumentV2[];
}

function loadBundle(value: unknown): StoryTemplateBundleV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { version: 2, templates: [] };
  const record = value as Record<string, unknown>;
  if (record.version !== 2 || !Array.isArray(record.templates) || record.templates.some((entry) => !isStoryTemplateDocumentV2(entry))) return { version: 2, templates: [] };
  return { version: 2, templates: record.templates.map((entry) => structuredClone(entry)) };
}

/** Browser and Tauri both consume the same generated author bundle. Invalid
 * hand-edited output fails closed to an empty catalog. */
export const STORY_TEMPLATE_BUNDLE_V2 = Object.freeze(loadBundle(bundle));
