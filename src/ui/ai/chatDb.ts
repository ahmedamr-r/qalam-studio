/**
 * AI chats are kept in IndexedDB, one record per chat. Generated screen specs make them too big
 * for localStorage. Each chat records its project (chats saved before projects belong to the first
 * project, the one the old single document became).
 */
import { openStores } from "../idb";

const chats = openStores("qalam-chats", 1, ["chats"])("chats");

export const loadAll = <T>() => chats.getAll<T>();
export const put = (id: string, value: unknown) => chats.put(id, value);
export const remove = (id: string) => chats.remove(id);
