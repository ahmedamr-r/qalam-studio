import { firstJson, insightHits, insightNumbers, posthogRead, posthogSearch, type InsightNumbers } from "./numbers";
import type { Hit, ToolCall } from "./recipes";

/*
 * A saved chart's numbers from an analytics tool's MCP server (pure): the calls to make and how to
 * read their answers. Code reads every number from the tool's own answer, and the person picks
 * which one they mean.
 *
 * PostHog's and Amplitude's calls were checked against their servers (November 2026; Amplitude's
 * docs name tools its server doesn't list, so go by its list). Mixpanel publishes its tools' names but
 * not their arguments or answers, so its calls are written from its docs and not yet checked against
 * a real account: a call names the arguments it wants and what else each may be called, `fitCall` fits
 * it to the schema the server gives, and its answers are read by shape.
 */

/** A planned call, with the other names its tool and arguments may go by on the server. */
export interface FittedCall extends ToolCall {
  also?: readonly string[];
  /** Failing those names, any tool whose name fits this. */
  like?: RegExp;
  aliases?: Readonly<Record<string, readonly string[]>>;
}

export interface NumbersRecipe {
  /** A first call for a tool whose calls name a project: which one (null when it won't say). */
  project?: { call: FittedCall; read: (answer: string) => string | null };
  search: (query: string, project?: string) => FittedCall;
  hits: (answer: string) => Hit[];
  read: (ref: string, project?: string) => FittedCall;
  numbers: (answer: string) => InsightNumbers;
  /** Its events, for an account with no saved chart that fits (only where the answers were checked against a real account). */
  events?: {
    /** A first call naming the projects its events are in. */
    places?: { call: FittedCall; read: (answer: string) => Record<string, string> };
    search: (query: string) => FittedCall;
    hits: (answer: string, o: { places: Record<string, string>; query: string }) => Hit[];
    count: (e: EventCount) => FittedCall;
    numbers: (answer: string, e: EventCount) => InsightNumbers;
  };
}

/** One event counted over a range: the unique users who did it. */
export interface EventCount {
  event: string;
  project?: string;
  days: number;
}

/** The ranges an event is counted over. */
export const COUNT_DAYS = [30, 90, 365] as const;

/** An event count as a ref, so it reads again as a saved chart does. */
export const eventRef = (e: EventCount) => `event:${e.project ?? ""}:${e.days}:${e.event}`;

export function readEventRef(ref: string): EventCount | null {
  const m = /^event:([^:]*):(\d+):(.+)$/s.exec(ref);
  if (!m || !(COUNT_DAYS as readonly number[]).includes(Number(m[2]))) return null;
  return { event: m[3], ...(m[1] ? { project: m[1] } : {}), days: Number(m[2]) };
}

/** Whether a tool can count its events. */
export const countsEvents = (id: string) => !!NUMBER_RECIPES[id]?.events;

const countLabel = (e: EventCount) => `Unique users, last ${e.days} days`;

/** A tool's input schema, as the server lists it. */
export type ToolSchemas = Readonly<Record<string, { properties?: Record<string, unknown> } | undefined>>;

/** The tool the server has for a call: by its names, else by what its name looks like. */
export const toolOn = (c: FittedCall, schemas: ToolSchemas): string | undefined => [c.tool, ...(c.also ?? [])].find((t) => schemas[t]) ?? (c.like ? Object.keys(schemas).find((t) => c.like!.test(t)) : undefined);

/** The call as the server's schema asks for it: the tool name it has, each argument under the name it takes, the ones it doesn't take left out. */
export function fitCall(c: FittedCall, schemas?: ToolSchemas): ToolCall {
  const plain = (tool: string, args: Record<string, unknown>): ToolCall => ({ tool, args, ...(c.match ? { match: c.match } : {}) });
  const tool = schemas ? toolOn(c, schemas) : undefined;
  const props = tool ? schemas?.[tool]?.properties : undefined;
  if (!tool || !props) return plain(tool ?? c.tool, c.args);
  const args = Object.entries(c.args).flatMap(([name, value]) => {
    const fits = [name, ...(c.aliases?.[name] ?? [])].find((n) => n in props);
    return fits ? [[fits, value] as const] : [];
  });
  return plain(tool, Object.fromEntries(args));
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const idOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : str(v));

function walk(v: unknown, visit: (o: Record<string, unknown>) => void) {
  if (Array.isArray(v)) for (const x of v) walk(x, visit);
  else if (isObject(v)) {
    visit(v);
    for (const x of Object.values(v)) walk(x, visit);
  }
}

const ID_KEYS = ["chartId", "chart_id", "bookmark_id", "report_id", "reportId", "short_id", "id"];
const NAME_KEYS = ["name", "title", "chartName", "report_name"];
const TYPE_KEYS = ["entityType", "entity_type", "type", "object_type"];
const pick = (o: Record<string, unknown>, keys: readonly string[], read: (v: unknown) => string | undefined) => keys.map((k) => read(o[k])).find((x) => x !== undefined);

/** The saved charts in a search's answer, in order: anything with an id and a name whose type, if it says one, is a chart or a report. */
export function savedCharts(answer: string): Hit[] {
  const out = new Map<string, Hit>();
  walk(firstJson(answer), (o) => {
    const id = pick(o, ID_KEYS, idOf);
    const title = pick(o, NAME_KEYS, str);
    const type = pick(o, TYPE_KEYS, str);
    if (!id || !title || (type && !/chart|report|insight|bookmark|funnel|retention|flow/i.test(type))) return;
    if (!out.has(id)) out.set(id, { id, title, ...(str(o.url) ? { url: str(o.url) } : {}), ...(str(o.description) ? { snippet: str(o.description)!.slice(0, 160) } : {}) });
  });
  return [...out.values()].slice(0, 20);
}

/** A project's id in an answer listing them: the first one found. */
export function firstProject(answer: string): string | null {
  let found: string | null = null;
  walk(firstJson(answer), (o) => {
    found ??= pick(o, ["project_id", "projectId", "appId", "app_id", "id"], idOf) ?? null;
  });
  return found;
}

const DATE = /^\d{4}-\d{2}-\d{2}/;
/** Keys that hold a number someone would mean, as against ids, times and counts of pages. */
const VALUE = /^(value|total|count|uniques?|average|avg|sum|rate|conv|conversion|overall_conv|aggregated_value)/i;
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The numbers in a chart's answer, by shape, each with where it was so the person can tell them
 * apart: a series by date gives its latest day, a list of numbers its last, and a field named for a
 * value its own. Ids, times and paging aren't numbers anyone means.
 */
export function chartNumbers(answer: string): InsightNumbers {
  const j = firstJson(answer);
  const out: InsightNumbers = { series: [] };
  const seen = new Set<string>();
  const add = (label: string, value: number) => {
    if (seen.has(label) || !Number.isFinite(value)) return;
    seen.add(label);
    out.series.push({ label: label || "Value", value: round(value) });
  };
  const visit = (v: unknown, path: string[], label?: string) => {
    if (Array.isArray(v)) {
      const nums = v.filter((x): x is number => typeof x === "number");
      if (v.length && nums.length === v.length) return add([...path, ...(label ? [label] : [])].join(" · "), nums[nums.length - 1]);
      v.forEach((x, i) => visit(x, path, isObject(x) ? undefined : String(i + 1)));
      return;
    }
    if (!isObject(v)) return;
    const entries = Object.entries(v);
    const days = entries.filter(([k, x]) => DATE.test(k) && typeof x === "number").sort(([a], [b]) => a.localeCompare(b));
    if (days.length && days.length === entries.length) return add(path.join(" · "), days[days.length - 1][1] as number);
    // The chart's own name says nothing about which number this is.
    const name = v === j ? undefined : pick(v, ["label", "name", "event", "title"], str);
    const here = name ? [...path, name] : path;
    for (const [k, x] of entries) {
      if (typeof x === "number") {
        if (VALUE.test(k)) add([...here, k].join(" · "), x);
      } else visit(x, /^(data|result|results|series|query|values)$/i.test(k) ? here : [...here, k]);
    }
  };
  visit(j, []);
  if (isObject(j)) {
    const name = pick(j, NAME_KEYS, str);
    if (name) out.name = name;
    if (str(j.url)) out.url = str(j.url);
  }
  out.series = out.series.slice(0, 12);
  return out;
}

const rows = (v: unknown): unknown[][] => (Array.isArray(v) ? v.filter((r): r is unknown[] => Array.isArray(r)) : []);
/** A cell as a number: 12, or "12.5%". */
const cellNumber = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?%?$/.test(v.trim()) ? parseFloat(v) : undefined);
const notAll = (segment: unknown) => (typeof segment === "string" && segment !== "All Users" ? ` · ${segment}` : "");

/** A funnel's rows: each segment's Total, its steps' counts by their columns, and its conversion worked out from them. */
function funnelNumbers(table: unknown[][], head: unknown[], out: InsightNumbers) {
  const isStep = (c: unknown) => typeof c === "string" && !/^(segment|date|conversion|is complete)$|time \(s\)$/i.test(c);
  const columns = head.flatMap((c, i) => (isStep(c) ? [{ label: c as string, i }] : []));
  for (const row of table.filter((r) => r[1] === "Total")) {
    const steps = columns.flatMap((c) => {
      const count = cellNumber(row[c.i]);
      return count === undefined ? [] : [{ label: c.label, count }];
    });
    if (steps.length >= 2) {
      out.steps ??= steps;
      if (steps[0].count > 0) out.series.push({ label: `Conversion %${notAll(row[0])}`, value: round((100 * steps[steps.length - 1].count) / steps[0].count) });
    }
    for (const s of steps) out.series.push({ label: `${s.label}${notAll(row[0])}`, value: s.count });
  }
}

/** Retention's rows: each segment's retained % on the days people mean. */
function retentionNumbers(table: unknown[][], head: unknown[], out: InsightNumbers) {
  for (const row of table.filter((r) => r[1] === "Overall" && r[2] === "Retained %"))
    for (const day of ["Day 1", "Day 7", "Day 30"]) {
      const value = cellNumber(row[head.indexOf(day)]);
      if (value !== undefined && head.includes(day)) out.series.push({ label: `Retained % · ${day}${notAll(row[0])}`, value });
    }
}

/**
 * A chart's numbers from Amplitude's own answer. An event chart comes as JSON: each series' total over
 * its range, then its latest complete point. A funnel or retention chart comes as rows of a table.
 * Another shape is read as any tool's.
 */
export function amplitudeNumbers(answer: string): InsightNumbers {
  const j = firstJson(answer);
  const top = isObject(j) ? j : {};
  const r = Array.isArray(top.results) && isObject(top.results[0]) ? top.results[0] : top;
  const data = isObject(r.data) ? r.data : {};
  const out: InsightNumbers = { series: [], ...(str(r.url) ? { url: str(r.url)!.split("?")[0] } : {}) };
  const title = str(r.name) ?? str(r.title);
  if (title) out.name = title;
  const csv = isObject(data.csvResponse) ? rows(data.csvResponse.data) : [];
  const at = csv.findIndex((row) => row[0] === "Segment");
  if (at >= 0) {
    const head = csv[at];
    const table = csv.slice(at + 1);
    if (head.includes("Conversion")) funnelNumbers(table, head, out);
    else retentionNumbers(table, head, out);
    return { ...out, series: out.series.slice(0, 12) };
  }
  const json = isObject(data.jsonResponse) ? data.jsonResponse : null;
  if (!json) return { ...chartNumbers(answer), ...out, series: chartNumbers(answer).series };
  const params = isObject(r.definition) && isObject(r.definition.params) ? r.definition.params : {};
  const events = Array.isArray(params.events) ? params.events : [];
  const names = Array.isArray(data.seriesNames) ? data.seriesNames : [];
  const meta = Array.isArray(json.seriesMetadata) ? json.seriesMetadata : [];
  const days = Array.isArray(json.xValuesForTimeSeries) ? json.xValuesForTimeSeries : [];
  const overall = Array.isArray(json.overallSeries) ? json.overallSeries : [];
  const series = Array.isArray(json.timeSeries) ? json.timeSeries : [];
  const value = (p: unknown) => (isObject(p) ? cellNumber(p.value) : undefined);
  overall.forEach((o, i) => {
    const m = isObject(meta[i]) ? meta[i] : {};
    const event = events[typeof m.eventIndex === "number" ? m.eventIndex : i];
    const name = `${(isObject(event) && str(event.event_type)) || `Series ${i + 1}`}${notAll(names[i])}`;
    const total = Array.isArray(o) ? value(o[0]) : undefined;
    if (total !== undefined) out.series.push({ label: `${name}${str(params.range) ? ` · ${str(params.range)}` : ""}`, value: total });
    const points = Array.isArray(series[i]) ? series[i] : [];
    const latest = value(points[points.length - 1]);
    const day = str(days[points.length - 1])?.slice(0, 10);
    if (latest !== undefined && day) out.series.push({ label: `${name} · ${day}`, value: latest });
  });
  return { ...out, series: out.series.slice(0, 12) };
}

/** Amplitude's projects by id, from its context. */
export function amplitudePlaces(answer: string): Record<string, string> {
  const j = firstJson(answer);
  const list = isObject(j) && Array.isArray(j.projects) ? j.projects : [];
  return Object.fromEntries(list.flatMap((p) => (isObject(p) && idOf(p.appId) && str(p.appName) ? [[idOf(p.appId)!, str(p.appName)!]] : [])));
}

/** Amplitude's events in a search's answer, each with its project. The project's name shows only when there's more than one to tell apart. */
export function amplitudeEvents(answer: string, o: { places: Record<string, string> }): Hit[] {
  const j = firstJson(answer);
  const list = isObject(j) && Array.isArray(j.results) ? j.results : [];
  return list.flatMap((r): Hit[] => {
    const e = isObject(r) && isObject(r.entity) ? r.entity : null;
    const name = e && e.type === "EVENT" ? str(e.name) : undefined;
    if (!e || !name) return [];
    const app = isObject(e.entityRef) ? idOf(e.entityRef.appId) : undefined;
    const place = app && Object.keys(o.places).length > 1 ? o.places[app] : undefined;
    const said = [place, str(e.description)].filter(Boolean).join(" · ");
    return [{ id: `${app ?? ""}:${name}`, title: name, ...(app ? { site: app } : {}), ...(said ? { snippet: said.slice(0, 160) } : {}) }];
  });
}

/** Amplitude's total for one counted event. With nobody doing it in the range it answers no series at all: no number, rather than a 0 Qalam made up. */
export function amplitudeCount(answer: string, e: EventCount): InsightNumbers {
  const j = firstJson(answer);
  const data = isObject(j) && isObject(j.data) ? j.data : {};
  const json = isObject(data.jsonResponse) ? data.jsonResponse : {};
  const overall = Array.isArray(json.overallSeries) ? json.overallSeries[0] : undefined;
  const first = Array.isArray(overall) ? overall[0] : undefined;
  const value = isObject(first) ? cellNumber(first.value) : undefined;
  return { name: e.event, series: value === undefined ? [] : [{ label: countLabel(e), value }] };
}

/** PostHog's events, as its schema tool lists them (Markdown, even asked for JSON), near the words asked for. "All events" isn't one. */
export function posthogEvents(answer: string, o: { query: string }): Hit[] {
  const words = o.query.trim().toLowerCase();
  return [...answer.replace(/\\n/g, "\n").matchAll(/^- \x60([^\x60]+)\x60(?: - (.*))?$/gm)].flatMap((m): Hit[] => {
    if (m[1] === "All events" || (words && !`${m[1]} ${m[2] ?? ""}`.toLowerCase().includes(words))) return [];
    return [{ id: m[1], title: m[1], ...(m[2] ? { snippet: m[2].slice(0, 160) } : {}) }];
  });
}

const WHY = "Reading a saved chart's number so a product team's goal shows where it stands.";
const POSTHOG_WHY = "Counting an event's unique users so a product team's goal shows where it stands.";
const posthogCall = (command: string): FittedCall => ({ tool: "exec", args: { command, context: POSTHOG_WHY, llm_model: "unknown" }, match: ["command"] });

const PROJECT_ALIASES = { project: ["project_id", "projectId", "appId", "app_id", "project"] };
const withProject = (project?: string) => (project ? { project } : {});

export const NUMBER_RECIPES: Record<string, NumbersRecipe> = {
  posthog: {
    search: posthogSearch,
    hits: insightHits,
    read: posthogRead,
    numbers: insightNumbers,
    events: {
      search: () => posthogCall(`call --json read-data-schema ${JSON.stringify({ query: { kind: "events", limit: 200 } })}`),
      hits: posthogEvents,
      // As a bold number, `dau` counts each person once over the whole range (90 against a distinct count's 90, on 242 events).
      count: (e) => posthogCall(`call --json query-trends ${JSON.stringify({ series: [{ kind: "EventsNode", event: e.event, math: "dau" }], dateRange: { date_from: `-${e.days}d` }, trendsFilter: { display: "BoldNumber" } })}`),
      numbers: (answer, e) => {
        const read = insightNumbers(answer);
        return { ...read, name: e.event, series: read.series.slice(0, 1).map((s) => ({ label: countLabel(e), value: s.value })) };
      },
    },
  },
  // Both take every project the person can reach, so neither needs one named.
  amplitude: {
    search: (query) => ({ tool: "search_amp_entities", like: /entit|^search$/i, args: { ...(query.trim() ? { queries: [query] } : {}), entityTypes: ["CHART"], limitPerQuery: 20, rationale: WHY }, match: ["queries", "entityTypes"] }),
    hits: savedCharts,
    read: (ref) => ({ tool: "get_amplitude_charts", like: /chart/i, args: { chartIds: [ref], include: "data", excludeIncompleteDatapoints: true, rationale: WHY }, match: ["chartIds", "include"] }),
    numbers: amplitudeNumbers,
    events: {
      places: { call: { tool: "get_amplitude_context", args: { rationale: WHY } }, read: amplitudePlaces },
      search: (query) => ({ tool: "search_amp_entities", like: /entit|^search$/i, args: { ...(query.trim() ? { queries: [query] } : {}), entityTypes: ["EVENT"], limitPerQuery: 30, rationale: WHY }, match: ["queries", "entityTypes"] }),
      hits: amplitudeEvents,
      count: (e) => ({ tool: "query_amplitude_data", args: { projectId: e.project ?? "", chart: { kind: "segmentation", events: [{ event: e.event }], date_range: { relative: `Last ${e.days} Days` } }, timeSeriesLimit: 0, rationale: WHY }, match: ["projectId", "chart"] }),
      numbers: amplitudeCount,
    },
  },
  mixpanel: {
    project: { call: { tool: "Get-Projects", args: {} }, read: firstProject },
    search: (query, project) => ({ tool: "Search-Entities", like: /search/i, args: { query, ...withProject(project) }, aliases: { query: ["q", "search", "search_term", "name"], ...PROJECT_ALIASES } }),
    hits: savedCharts,
    read: (ref, project) => ({ tool: "Get-Report", like: /report/i, args: { report_id: ref, include_results: true, ...withProject(project) }, aliases: { report_id: ["bookmark_id", "reportId", "id"], include_results: ["includeResults", "with_results"], ...PROJECT_ALIASES } }),
    numbers: chartNumbers,
  },
};
