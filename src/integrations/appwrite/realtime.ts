/**
 * Realtime — equivalente ao supabase.channel(...).on('postgres_changes', ...).
 *
 * Supabase:  supabase.channel('x').on('postgres_changes',
 *              { event:'*', schema:'public', table:'tasks' }, cb).subscribe()
 * Appwrite:  subscribeCollection('tasks', cb)
 *
 * O canal do Appwrite é:
 *   databases.<db>.collections.<col>.documents          (toda a collection)
 *   databases.<db>.collections.<col>.documents.<docId>  (um documento)
 *
 * Só chegam eventos dos documentos que a sessão TEM PERMISSÃO DE LER —
 * é assim que o Appwrite substitui o filtro de RLS no realtime.
 */
import { client } from './client';
import { DATABASE_ID, COLLECTIONS } from './types';
import type { CollectionTypeMap } from './types';

type Cid = keyof CollectionTypeMap;
export type ChangeEvent = 'create' | 'update' | 'delete';

export interface RealtimeChange<T> {
  event: ChangeEvent;
  document: T;
  raw: { events: string[]; timestamp: number };
}

const channelFor = (c: Cid, docId?: string) =>
  `databases.${DATABASE_ID}.collections.${COLLECTIONS[c]}.documents${docId ? `.${docId}` : ''}`;

function eventKind(events: string[]): ChangeEvent | null {
  if (events.some((e) => e.endsWith('.create'))) return 'create';
  if (events.some((e) => e.endsWith('.update'))) return 'update';
  if (events.some((e) => e.endsWith('.delete'))) return 'delete';
  return null;
}

export function subscribeCollection<K extends Cid>(
  collection: K,
  onChange: (change: RealtimeChange<CollectionTypeMap[K]>) => void,
): () => void {
  return client.subscribe(channelFor(collection), (res: { events: string[]; payload: unknown; timestamp: number }) => {
    const event = eventKind(res.events);
    if (!event) return;
    onChange({ event, document: res.payload as CollectionTypeMap[K], raw: { events: res.events, timestamp: res.timestamp } });
  });
}

export function subscribeDocument<K extends Cid>(
  collection: K, documentId: string,
  onChange: (change: RealtimeChange<CollectionTypeMap[K]>) => void,
): () => void {
  return client.subscribe(channelFor(collection, documentId), (res: { events: string[]; payload: unknown; timestamp: number }) => {
    const event = eventKind(res.events);
    if (!event) return;
    onChange({ event, document: res.payload as CollectionTypeMap[K], raw: { events: res.events, timestamp: res.timestamp } });
  });
}

/** Vários canais de uma vez; devolve um único unsubscribe. */
export function subscribeMany(
  channels: Cid[],
  onChange: (collection: Cid, change: RealtimeChange<unknown>) => void,
): () => void {
  const unsubs = channels.map((c) => subscribeCollection(c, (ch) => onChange(c, ch as RealtimeChange<unknown>)));
  return () => unsubs.forEach((u) => u());
}
