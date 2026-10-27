/**
 * AI chats are kept in the organization's folder, one file per chat under its project
 * (chats/<projectId>/, kept out of Git as AI working memory). Chats saved before projects have no
 * project and belong to the first one, the one the old single document became.
 */
import { orgFetch, orgJson } from "@/org/client";

export const loadAll = <T>() => orgJson<T[]>("/chats");
export const put = async (id: string, value: unknown) => {
  await orgFetch(`/chats/${id}`, { method: "PUT", json: value });
};
export const remove = async (id: string) => {
  await orgFetch(`/chats/${id}`, { method: "DELETE" });
};
