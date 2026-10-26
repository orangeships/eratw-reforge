/** Portable author content. Roles/places bind when accepted, each graph compiles at its own scene. */
export type StoryletTriggerV1 = { kind: "immediate" } | { kind: "dialogue"; speaker: string } | { kind: "arrival"; place: string };
export type StoryletNodeV1 =
  | { id: string; kind: "narration"; text: string; next: string }
  | { id: string; kind: "speech"; speaker: string; text: string; next: string }
  | { id: string; kind: "choice"; question: string; options: Array<{ id: string; label: string; next: string }> }
  | { id: string; kind: "end"; outcome: string; summary: string };
export interface StoryletHookDefinitionV1 {
  id: string;
  speaker: string;
  objective: string;
  fallback?: string[];
  relationship?: { minFavor?: number; minTrust?: number; maxRebellion?: number };
  completion?: "expression" | "player-response";
  responses?: Array<{ id: string; label: string; result: "accept" | "reject"; lines: string[] }>;
}
export interface StoryletSceneV1 {
  id: string;
  /** Omit only for a cast-free immediate announcement, staged wherever the player is. */
  place?: string;
  participants: string[];
  trigger: StoryletTriggerV1;
  guard?: { startAfterMinutes?: number; endAfterMinutes?: number; hours?: { start: number; end: number } };
  graph?: { start: string; nodes: StoryletNodeV1[] };
  hooks?: StoryletHookDefinitionV1[];
  transitions?: Array<{ when: { kind: "outcome"; id: string } | { kind: "hook"; id: string; status: "resolved" | "declined" | "expired" | "cancelled" }; next: string }>;
}
export interface StoryletDocumentV1 {
  version: 1;
  id: string;
  title: string;
  premise: string;
  roles: string[];
  places: string[];
  start: string;
  scenes: StoryletSceneV1[];
}
export interface StoryletBindingsV1 { characters: Record<string, number>; locations: Record<string, string> }

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 48): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const keys = (v: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => k in v) && Object.keys(v).every(k => [...required, ...optional].includes(k));
const list = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every(x => text(x)) && new Set(v).size === v.length;
const nonnegative = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;

export function validateStoryletDocument(value: unknown): string[] {
  if (!object(value) || !keys(value, ["version", "id", "title", "premise", "roles", "places", "start", "scenes"])) return ["storylet document has unknown or missing fields"];
  if (value.version !== 1 || !text(value.id) || !text(value.title, 160) || !text(value.premise, 1600)
    || !list(value.roles, 3) || !list(value.places, 12) || !text(value.start)
    || !Array.isArray(value.scenes) || !value.scenes.length || value.scenes.length > 12) return ["storylet document identity or budgets are invalid"];
  const roles = new Set(value.roles), places = new Set(value.places);
  const scenes = value.scenes;
  const diagnostics: string[] = [];
  const sceneIds = new Set<string>();
  for (const scene of scenes) {
    if (!object(scene) || !keys(scene, ["id", "participants", "trigger"], ["place", "guard", "graph", "hooks", "transitions"])
      || !text(scene.id) || sceneIds.has(scene.id) || scene.place !== undefined && (typeof scene.place !== "string" || !places.has(scene.place))
      || !list(scene.participants, 3) || scene.participants.some(r => !roles.has(r))) { diagnostics.push("scene identity or roles are invalid"); continue; }
    sceneIds.add(scene.id);
    const t = scene.trigger;
    if (scene.place === undefined && (!object(t) || t.kind !== "immediate" || scene.participants.length > 0 || scene.hooks !== undefined)) diagnostics.push("only a cast-free immediate announcement may omit place");
    if (!object(t) || !(t.kind === "immediate" && keys(t, ["kind"])
      || t.kind === "dialogue" && keys(t, ["kind", "speaker"]) && typeof t.speaker === "string" && scene.participants.includes(t.speaker)
      || t.kind === "arrival" && keys(t, ["kind", "place"]) && t.place === scene.place)) diagnostics.push(`scene ${scene.id} trigger is invalid`);
    if (scene.guard !== undefined) {
      const g = scene.guard;
      if (!object(g) || !keys(g, [], ["startAfterMinutes", "endAfterMinutes", "hours"])
        || ["startAfterMinutes", "endAfterMinutes"].some(k => g[k] !== undefined && !nonnegative(g[k]))
        || g.startAfterMinutes !== undefined && g.endAfterMinutes !== undefined && Number(g.endAfterMinutes) <= Number(g.startAfterMinutes)
        || g.hours !== undefined && (!object(g.hours) || !keys(g.hours, ["start", "end"]) || !nonnegative(g.hours.start) || !nonnegative(g.hours.end)
          || Number(g.hours.start) >= Number(g.hours.end) || Number(g.hours.end) > 24)) diagnostics.push(`scene ${scene.id} time guard is invalid`);
    }
    const outcomes = new Set<string>(), hookIds = new Set<string>();
    if (scene.hooks !== undefined) {
      if (!Array.isArray(scene.hooks) || scene.hooks.length > 4) diagnostics.push("scene hook budget is invalid");
      else for (const h of scene.hooks) {
        if (!object(h) || !keys(h, ["id", "speaker", "objective"], ["fallback", "relationship", "completion", "responses"])
          || !text(h.id) || hookIds.has(h.id) || typeof h.speaker !== "string" || !scene.participants.includes(h.speaker) || !text(h.objective, 800)) { diagnostics.push("hook definition is invalid"); continue; }
        hookIds.add(h.id);
        if (h.fallback !== undefined && (!Array.isArray(h.fallback) || !h.fallback.length || h.fallback.length > 8 || !h.fallback.every(l => text(l, 1200)))) diagnostics.push("hook fallback is invalid");
        if (h.relationship !== undefined && (!object(h.relationship) || !keys(h.relationship, [], ["minFavor", "minTrust", "maxRebellion"])
          || Object.values(h.relationship).some(v => !nonnegative(v)) || Number(h.relationship.maxRebellion ?? 0) > 3)) diagnostics.push("hook relationship guard is invalid");
        if (h.completion !== undefined && !["expression", "player-response"].includes(String(h.completion))) diagnostics.push("hook completion is invalid");
        if (h.responses !== undefined && (!Array.isArray(h.responses) || !h.responses.length || h.responses.length > 4
          || h.responses.some(r => !object(r) || !keys(r, ["id", "label", "result", "lines"]) || !text(r.id) || !text(r.label)
            || !["accept", "reject"].includes(String(r.result)) || !Array.isArray(r.lines) || !r.lines.length || r.lines.length > 8 || !r.lines.every(l => text(l, 1200)))
          || new Set(h.responses.map(r => object(r) ? r.id : null)).size !== h.responses.length
          || new Set(h.responses.map(r => object(r) ? r.label : null)).size !== h.responses.length)) diagnostics.push("hook responses are invalid");
      }
    }
    const graph = scene.graph;
    if (graph !== undefined) {
      if (!object(graph) || !keys(graph, ["start", "nodes"]) || !text(graph.start) || !Array.isArray(graph.nodes) || graph.nodes.length < 2 || graph.nodes.length > 24) diagnostics.push("scene graph budget is invalid");
      else {
        const nodes = graph.nodes, nodeIds = new Set<string>(), links = new Map<string, string[]>();
        for (const n of nodes) {
          if (!object(n) || !text(n.id) || nodeIds.has(n.id)) { diagnostics.push("graph node identity is invalid"); continue; }
          nodeIds.add(n.id);
          if (n.kind === "narration" || n.kind === "speech") {
            if (!keys(n, ["id", "kind", "text", ...(n.kind === "speech" ? ["speaker"] : [])], ["next"]) || !text(n.text, n.kind === "speech" ? 300 : 600)
              || n.kind === "speech" && (typeof n.speaker !== "string" || !scene.participants.includes(n.speaker)) || !text(n.next)) diagnostics.push("story text node is invalid");
            links.set(n.id, typeof n.next === "string" ? [n.next] : []);
          } else if (n.kind === "choice") {
            if (!keys(n, ["id", "kind", "question", "options"]) || !text(n.question, 300) || !Array.isArray(n.options)
              || n.options.length < 2 || n.options.length > 3 || n.options.some(o => !object(o) || !keys(o, ["id", "label", "next"]) || !text(o.id) || !text(o.label) || !text(o.next))
              || new Set(n.options.map(o => object(o) ? o.id : null)).size !== n.options.length) diagnostics.push("story choice is invalid");
            links.set(n.id, Array.isArray(n.options) ? n.options.flatMap(o => object(o) && typeof o.next === "string" ? [o.next] : []) : []);
          } else if (n.kind === "end") {
            if (!keys(n, ["id", "kind", "outcome", "summary"]) || !text(n.outcome) || !text(n.summary, 600)) diagnostics.push("story ending is invalid");
            if (typeof n.outcome === "string") outcomes.add(n.outcome);
            links.set(n.id, []);
          } else diagnostics.push("unsupported story node");
        }
        const visited = new Set<string>(), stack = new Set<string>();
        const visit = (id: string): void => {
          if (stack.has(id)) { diagnostics.push("scene graph has a cycle"); return; }
          if (visited.has(id)) return;
          if (!nodeIds.has(id)) { diagnostics.push("scene graph has an unknown link"); return; }
          visited.add(id); stack.add(id); for (const next of links.get(id) ?? []) visit(next); stack.delete(id);
        };
        visit(graph.start); if (visited.size !== nodeIds.size) diagnostics.push("scene graph has unreachable nodes");
      }
    }
    if (!graph && hookIds.size === 0) diagnostics.push("scene must contain a graph or a dialogue hook");
    if (object(t) && t.kind === "dialogue" && (!Array.isArray(scene.hooks) || !scene.hooks.some(h => object(h) && h.speaker === t.speaker))) diagnostics.push("dialogue scene requires a speaker-owned hook");
    if (scene.transitions !== undefined && (!Array.isArray(scene.transitions) || scene.transitions.length > 8 || scene.transitions.some(tr => !object(tr) || !keys(tr, ["when", "next"]) || !text(tr.next)
      || !object(tr.when) || !(tr.when.kind === "outcome" && keys(tr.when, ["kind", "id"]) && outcomes.has(String(tr.when.id))
        || tr.when.kind === "hook" && keys(tr.when, ["kind", "id", "status"]) && hookIds.has(String(tr.when.id)) && ["resolved", "declined", "expired", "cancelled"].includes(String(tr.when.status)))))) diagnostics.push("scene transitions are invalid");
  }
  if (!sceneIds.has(value.start)) diagnostics.push("storylet start scene is unknown");
  const visited = new Set<string>(), stack = new Set<string>();
  const visit = (id: string): void => {
    if (stack.has(id)) { diagnostics.push("storylet scene transitions must be acyclic"); return; }
    if (visited.has(id)) return;
    const scene = scenes.find(s => object(s) && s.id === id);
    if (!scene) { diagnostics.push("storylet transition has an unknown scene"); return; }
    visited.add(id); stack.add(id);
    if (object(scene) && Array.isArray(scene.transitions)) for (const tr of scene.transitions) if (object(tr) && typeof tr.next === "string") visit(tr.next);
    stack.delete(id);
  };
  visit(value.start); if (visited.size !== sceneIds.size) diagnostics.push("storylet has unreachable scenes");
  return [...new Set(diagnostics)];
}
