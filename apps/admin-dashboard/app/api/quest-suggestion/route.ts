import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type Difficulty = "Easy" | "Medium" | "Hard";
type Draft = { title: string; description: string; requirement: string; difficulty: Difficulty; targetGenre: string; points: number; timeLimitDays: number; rationale: string };
type CatalogBook = { book_genre: string | null; book_copies: { copy_status: string }[] | null };

const bounds: Record<Difficulty, { min: number; max: number; days: number; points: number }> = {
  Easy: { min: 1, max: 2, days: 7, points: 50 },
  Medium: { min: 2, max: 3, days: 14, points: 100 },
  Hard: { min: 3, max: 5, days: 21, points: 180 },
};
const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

function parseDraft(value: unknown, difficulty: Difficulty, inventory: Map<string, number>): Draft | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const genre = clean(item.targetGenre, 100);
  const available = inventory.get(genre) ?? 0;
  const level = bounds[difficulty];
  const count = Math.max(level.min, Math.min(level.max, Math.floor(Number(item.bookCount) || level.min), available));
  if (!genre || available < level.min || count < 1) return null;
  const days = Math.max(3, Math.min(level.days, Math.floor(Number(item.timeLimitDays) || level.days)));
  const points = Math.max(10, Math.min(level.points * 2, Math.floor(Number(item.points) || level.points)));
  const title = clean(item.title, 120) || `${genre} Reading Quest`;
  const requirement = `Read ${count} available ${genre} ${count === 1 ? "book" : "books"} within ${days} days.`;
  return { title, description: clean(item.description, 220) || requirement, requirement, difficulty, targetGenre: genre, points, timeLimitDays: days, rationale: `Validated against ${available} available ${genre} ${available === 1 ? "title" : "titles"}.` };
}

function fallbackDraft(difficulty: Difficulty, inventory: Map<string, number>, recentGenres: string[]): Draft | null {
  const level = bounds[difficulty];
  const candidates = [...inventory.entries()].filter(([, count]) => count >= level.min)
    .sort((left, right) => recentGenres.filter(value => value === left[0]).length - recentGenres.filter(value => value === right[0]).length || right[1] - left[1]);
  const [genre, available] = candidates[0] ?? [];
  if (!genre || !available) return null;
  const count = Math.min(level.max, available);
  const requirement = `Read ${count} available ${genre} ${count === 1 ? "book" : "books"} within ${level.days} days.`;
  return { title: `${genre} Trail`, description: `Explore the ${genre} collection and complete ${count} ${count === 1 ? "book" : "books"}.`, requirement, difficulty, targetGenre: genre, points: level.points, timeLimitDays: level.days, rationale: `Catalog-safe fallback using ${available} available ${genre} ${available === 1 ? "title" : "titles"}.` };
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const authorization = request.headers.get("authorization");
  if (!url || !key) return NextResponse.json({ error: "Quest assistance is not configured." }, { status: 503 });
  if (!authorization?.startsWith("Bearer ")) return NextResponse.json({ error: "Librarian sign-in is required." }, { status: 401 });
  const caller = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const librarian = await caller.schema("sora_v2").rpc("is_librarian");
  if (librarian.error || librarian.data !== true) return NextResponse.json({ error: "Librarian access is required." }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const requested = body && typeof body === "object" ? clean((body as Record<string, unknown>).difficulty, 20) : "";
  const difficulty: Difficulty = requested === "Medium" || requested === "Hard" ? requested : "Easy";

  const [catalogResult, questResult] = await Promise.all([
    caller.schema("sora_v2").from("books").select("book_genre,book_copies(copy_status)"),
    caller.schema("sora_v2").from("quests").select("target_genre").order("created_at", { ascending: false }).limit(20),
  ]);
  if (catalogResult.error) return NextResponse.json({ error: "The catalog could not be checked right now." }, { status: 503 });
  const inventory = new Map<string, number>();
  for (const book of catalogResult.data as CatalogBook[]) {
    const genre = book.book_genre?.trim();
    if (genre && book.book_copies?.some(copy => copy.copy_status === "In-Shelf")) inventory.set(genre, (inventory.get(genre) ?? 0) + 1);
  }
  const recentGenres = (questResult.data ?? []).map(item => clean(item.target_genre, 100)).filter(Boolean);
  const fallback = fallbackDraft(difficulty, inventory, recentGenres);
  if (!fallback) return NextResponse.json({ error: `There are not enough available catalog titles for a ${difficulty.toLowerCase()} quest.` }, { status: 422 });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ draft: fallback, source: "template" });
  const model = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash-0731";
  const prompt = `Draft one varied ${difficulty} reading quest. Use only a genre and available-title count from CATALOG INVENTORY. Do not exceed the difficulty bounds or available inventory. Avoid repeating RECENT GENRES when possible. Return JSON only with title, description, targetGenre, bookCount, timeLimitDays, and points. DIFFICULTY BOUNDS: ${JSON.stringify(bounds[difficulty])}. CATALOG INVENTORY: ${JSON.stringify(Object.fromEntries(inventory))}. RECENT GENRES: ${JSON.stringify(recentGenres)}.`;
  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://sora-admin.vercel.app", "X-Title": "S.O.R.A. Quest Assistant" }, body: JSON.stringify({ model, temperature: 0.65, max_tokens: 220, ...(model.startsWith("deepseek/") ? { reasoning: { enabled: false } } : {}), response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }), signal: AbortSignal.timeout(8_000) });
    if (!upstream.ok) return NextResponse.json({ draft: fallback, source: "template" });
    const result = await upstream.json() as { choices?: { message?: { content?: unknown } }[] };
    const content = result.choices?.[0]?.message?.content;
    const parsed = typeof content === "string" ? parseDraft(JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")), difficulty, inventory) : null;
    return NextResponse.json({ draft: parsed ?? fallback, source: parsed ? "ai" : "template" });
  } catch { return NextResponse.json({ draft: fallback, source: "template" }); }
}
