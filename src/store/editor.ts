import { create } from 'zustand';
import { recomputeAll } from '../../shared/completion';
import type { EligibilityCriterion, Endpoint, Objective, ProtocolBundle, SaveRequest, SoaSchedule, StudyArm } from '../../shared/types';
import { api } from '../lib/api';

type EntityKey = 'objectives' | 'endpoints' | 'arms' | 'criteria' | 'soa';
type Meta = NonNullable<SaveRequest['meta']>;
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface EditorState {
  bundle: ProtocolBundle | null;
  loadingId: string | null;
  loadError: string | null;
  saveState: SaveState;
  saveError: string | null;
  lastSavedAt: string | null;
  recovered: boolean;
  dirtySubs: Set<string>;
  dirtyMeta: Meta;
  dirtyEntities: Set<EntityKey>;
  load: (id: string, force?: boolean) => Promise<void>;
  reload: () => Promise<void>;
  setSubContent: (subId: string, key: string, value: unknown) => void;
  setMeta: (key: keyof Meta, value: string) => void;
  setObjectives: (list: Objective[]) => void;
  setEndpoints: (list: Endpoint[]) => void;
  setArms: (list: StudyArm[]) => void;
  setCriteria: (list: EligibilityCriterion[]) => void;
  setSoa: (soa: SoaSchedule) => void;
  flush: (opts?: { keepalive?: boolean }) => Promise<boolean>;
  hasPending: () => boolean;
}

const AUTOSAVE_MS = 1000;
const RETRY_MS = 5000;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<boolean> | null = null;

const pendingKey = (id: string) => `protocoliq:pending:${id}`;

function buildRequest(s: EditorState): SaveRequest | null {
  const b = s.bundle;
  if (!b) return null;
  const req: SaveRequest = { baseRevision: b.protocol.revision };
  if (Object.keys(s.dirtyMeta).length) req.meta = { ...s.dirtyMeta };
  if (s.dirtySubs.size) {
    const subs = b.sections.flatMap((x) => x.subsections);
    req.subsections = [...s.dirtySubs].map((id) => ({ id, content: subs.find((x) => x.id === id)?.content ?? {} }));
  }
  for (const k of s.dirtyEntities) (req as Record<string, unknown>)[k] = b[k];
  // Endpoint links reference objectives, so they are always saved together.
  if (req.objectives && !req.endpoints) req.endpoints = b.endpoints;
  return req.meta || req.subsections || s.dirtyEntities.size ? req : null;
}

/** Persist unsaved edits locally so a crash, reload or network failure cannot lose them. */
function persistPending(s: EditorState) {
  if (!s.bundle) return;
  const req = buildRequest(s);
  try {
    if (req) localStorage.setItem(pendingKey(s.bundle.protocol.id), JSON.stringify({ at: new Date().toISOString(), req }));
    else localStorage.removeItem(pendingKey(s.bundle.protocol.id));
  } catch {
    /* storage full or unavailable */
  }
}

function applyRequest(bundle: ProtocolBundle, req: SaveRequest): ProtocolBundle {
  const b: ProtocolBundle = structuredClone(bundle);
  if (req.meta) {
    for (const [k, v] of Object.entries(req.meta)) {
      if (k in b.study) (b.study as unknown as Record<string, unknown>)[k] = v;
      else (b.protocol as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const item of req.subsections ?? []) {
    for (const sec of b.sections) {
      const sub = sec.subsections.find((x) => x.id === item.id);
      if (sub) sub.content = item.content;
    }
  }
  if (req.objectives) b.objectives = req.objectives;
  if (req.endpoints) b.endpoints = req.endpoints;
  if (req.arms) b.arms = req.arms;
  if (req.criteria) b.criteria = req.criteria;
  if (req.soa) b.soa = req.soa;
  return recomputeAll(b);
}

export const useEditor = create<EditorState>((set, get) => {
  const schedule = (ms = AUTOSAVE_MS) => {
    clearTimeout(timer);
    timer = setTimeout(() => void get().flush(), ms);
  };

  const mutate = (fn: (b: ProtocolBundle) => ProtocolBundle, mark: (s: EditorState) => Partial<EditorState>) => {
    const s = get();
    if (!s.bundle) return;
    const bundle = recomputeAll(fn(s.bundle));
    set({ bundle, ...mark(s), saveState: 'dirty' });
    persistPending(get());
    schedule();
  };

  return {
    bundle: null,
    loadingId: null,
    loadError: null,
    saveState: 'idle',
    saveError: null,
    lastSavedAt: null,
    recovered: false,
    dirtySubs: new Set(),
    dirtyMeta: {},
    dirtyEntities: new Set(),

    hasPending: () => {
      const s = get();
      return s.dirtySubs.size > 0 || Object.keys(s.dirtyMeta).length > 0 || s.dirtyEntities.size > 0 || !!inFlight;
    },

    load: async (id, force = false) => {
      const cur = get();
      if (!force && cur.bundle?.protocol.id === id) return;
      if (cur.bundle && cur.bundle.protocol.id !== id && cur.hasPending()) await cur.flush();
      set({ loadingId: id, loadError: null });
      try {
        let bundle = await api.bundle(id, true);
        let recovered = false;
        const stored = localStorage.getItem(pendingKey(id));
        let dirty: Pick<EditorState, 'dirtySubs' | 'dirtyMeta' | 'dirtyEntities'> = { dirtySubs: new Set(), dirtyMeta: {}, dirtyEntities: new Set() };
        if (stored) {
          const { req } = JSON.parse(stored) as { req: SaveRequest };
          bundle = applyRequest(bundle, req);
          recovered = true;
          dirty = {
            dirtySubs: new Set((req.subsections ?? []).map((x) => x.id)),
            dirtyMeta: req.meta ?? {},
            dirtyEntities: new Set((['objectives', 'endpoints', 'arms', 'criteria', 'soa'] as EntityKey[]).filter((k) => req[k])),
          };
        }
        set({ bundle, loadingId: null, recovered, saveState: recovered ? 'dirty' : 'idle', saveError: null, lastSavedAt: bundle.protocol.updatedAt, ...dirty });
        if (recovered) await get().flush();
      } catch (e) {
        set({ loadingId: null, loadError: (e as Error).message });
      }
    },

    reload: async () => {
      const id = get().bundle?.protocol.id;
      if (!id) return;
      await get().flush();
      const bundle = await api.bundle(id);
      set({ bundle, lastSavedAt: bundle.protocol.updatedAt });
    },

    setSubContent: (subId, key, value) =>
      mutate(
        (b) => ({
          ...b,
          sections: b.sections.map((sec) => ({
            ...sec,
            subsections: sec.subsections.map((x) => (x.id === subId ? { ...x, content: { ...x.content, [key]: value } } : x)),
          })),
        }),
        (s) => ({ dirtySubs: new Set(s.dirtySubs).add(subId) }),
      ),

    setMeta: (key, value) =>
      mutate(
        (b) => (key in b.study ? { ...b, study: { ...b.study, [key]: value } } : { ...b, protocol: { ...b.protocol, [key]: value } }),
        (s) => ({ dirtyMeta: { ...s.dirtyMeta, [key]: value } }),
      ),

    setObjectives: (list) =>
      mutate(
        (b) => ({ ...b, objectives: list, endpoints: b.endpoints.map((e) => ({ ...e, objectiveIds: e.objectiveIds.filter((id) => list.some((o) => o.id === id)) })) }),
        (s) => ({ dirtyEntities: new Set(s.dirtyEntities).add('objectives').add('endpoints') }),
      ),
    setEndpoints: (list) => mutate((b) => ({ ...b, endpoints: list }), (s) => ({ dirtyEntities: new Set(s.dirtyEntities).add('endpoints') })),
    setArms: (list) => mutate((b) => ({ ...b, arms: list }), (s) => ({ dirtyEntities: new Set(s.dirtyEntities).add('arms') })),
    setCriteria: (list) => mutate((b) => ({ ...b, criteria: list }), (s) => ({ dirtyEntities: new Set(s.dirtyEntities).add('criteria') })),
    setSoa: (soa) => mutate((b) => ({ ...b, soa }), (s) => ({ dirtyEntities: new Set(s.dirtyEntities).add('soa') })),

    flush: async (opts = {}) => {
      clearTimeout(timer);
      if (inFlight) {
        await inFlight;
        if (!get().hasPending()) return true;
      }
      const s = get();
      const req = buildRequest(s);
      if (!req || !s.bundle) return true;
      const protocolId = s.bundle.protocol.id;
      const sent = { dirtySubs: s.dirtySubs, dirtyMeta: s.dirtyMeta, dirtyEntities: s.dirtyEntities };
      set({ saveState: 'saving', dirtySubs: new Set(), dirtyMeta: {}, dirtyEntities: new Set() });

      inFlight = (async () => {
        try {
          const res = await api.save(protocolId, req, opts.keepalive);
          const cur = get();
          if (cur.bundle?.protocol.id !== protocolId) return true;
          const bundle = structuredClone(cur.bundle);
          // Only take server-managed fields so edits typed during the request are not overwritten.
          const { revision, status, updatedAt } = res.protocol;
          bundle.protocol = { ...bundle.protocol, revision, status, updatedAt };
          bundle.study = { ...bundle.study, updatedAt: res.study.updatedAt };
          for (const sec of bundle.sections) for (const sub of sec.subsections) if (res.completion[sub.id]) sub.completionStatus = res.completion[sub.id];
          const stillDirty = cur.dirtySubs.size || Object.keys(cur.dirtyMeta).length || cur.dirtyEntities.size;
          set({ bundle: stillDirty ? recomputeAll(bundle) : bundle, saveState: stillDirty ? 'dirty' : 'saved', saveError: null, lastSavedAt: res.protocol.updatedAt, recovered: false });
          persistPending(get());
          if (stillDirty) schedule();
          return true;
        } catch (e) {
          const cur = get();
          // Put the unsent changes back so nothing is lost, then retry.
          const dirtySubs = new Set([...sent.dirtySubs, ...cur.dirtySubs]);
          const dirtyEntities = new Set([...sent.dirtyEntities, ...cur.dirtyEntities]);
          set({ dirtySubs, dirtyEntities, dirtyMeta: { ...sent.dirtyMeta, ...cur.dirtyMeta }, saveState: 'error', saveError: (e as Error).message });
          persistPending(get());
          schedule(RETRY_MS);
          return false;
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },
  };
});

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (ev) => {
    const s = useEditor.getState();
    if (s.hasPending()) {
      void s.flush({ keepalive: true });
      ev.preventDefault();
    }
  });
}
