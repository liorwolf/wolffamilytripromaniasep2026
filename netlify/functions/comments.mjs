// Comments API for the garden. Stored in Netlify Blobs (store "comments"), one JSON array per page path.
//   GET    /api/comments?page=/some/path/   -> [{id, name, text, time}]
//   GET    /api/comments?all=1              -> { "<page key>": [...], ... }   (used to review all comments)
//   POST   /api/comments  {page, name, text} -> the stored comment
//   DELETE /api/comments?page=...&id=...     -> needs header x-admin-key = COMMENTS_ADMIN_KEY env var
import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const clean = (value, max) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, max);

// Blob keys may not start with "/" or contain "//", so "/a/b/" becomes "a/b" and the front page "home".
const pageKey = (page) =>
  clean(page, 300).replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "") || "home";

export default async (req) => {
  const store = getStore("comments");
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.searchParams.has("all")) {
      const { blobs } = await store.list();
      const out = {};
      for (const b of blobs) out[b.key] = (await store.get(b.key, { type: "json" })) || [];
      return json(out);
    }
    const key = pageKey(url.searchParams.get("page"));
    return json((await store.get(key, { type: "json" })) || []);
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "bad json" }, 400);
    }
    if (body.website) return json({ ok: true }); // honeypot field filled in: silently ignore
    const key = pageKey(body.page);
    const name = clean(body.name, 40);
    const text = clean(body.text, 2000);
    if (!name || !text) return json({ error: "name and text are required" }, 400);
    const list = (await store.get(key, { type: "json" })) || [];
    if (list.length >= 500) return json({ error: "too many comments on this page" }, 429);
    const comment = { id: crypto.randomUUID(), name, text, time: new Date().toISOString() };
    list.push(comment);
    await store.setJSON(key, list);
    return json(comment, 201);
  }

  if (req.method === "DELETE") {
    const adminKey = process.env.COMMENTS_ADMIN_KEY;
    if (!adminKey || req.headers.get("x-admin-key") !== adminKey) return json({ error: "unauthorized" }, 401);
    const key = pageKey(url.searchParams.get("page"));
    const id = clean(url.searchParams.get("id"), 80);
    const list = ((await store.get(key, { type: "json" })) || []).filter((c) => c.id !== id);
    await store.setJSON(key, list);
    return json({ ok: true, remaining: list.length });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/comments" };
