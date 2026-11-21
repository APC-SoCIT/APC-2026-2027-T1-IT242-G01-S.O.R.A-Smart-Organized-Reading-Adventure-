import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type ChatMessage = { role: "user" | "assistant"; content: string };
type TopBook = { title: string; sessions: number };
type GenreStat = { genre: string; sessions: number };
type DailyActivity = { day: string; sessions: number; minutes: number };
type AnalyticsContext = {
  totalTitles: number; totalCopies: number; availableCopies: number;
  copiesWithReaders: number; copiesInReturnCart: number; readerProfiles: number;
  activeReaderAccounts: number; activeSessions: number; completedSessions: number;
  totalReadingMinutes: number; averageReadingMinutes: number; activeMemberships: number;
  activeQuests: number; questEnrollments: number; topBooks: TopBook[];
  reportingPeriod: string; genreStats: GenreStat[]; leastUsedBooks: TopBook[];
  dailyActivity: DailyActivity[]; questCompletionRate: number;
};

const buckets = new Map<string, { count: number; resetAt: number }>();
let openRouterUnavailableUntil = 0;
const cleanText = (value: unknown, max = 800) => typeof value === "string" ? value.trim().slice(0, max) : "";
const boundedNumber = (value: unknown, max = 1_000_000) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(Math.round(number), max)) : 0;
};

function parseContext(value: unknown): AnalyticsContext | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return {
    totalTitles: boundedNumber(item.totalTitles), totalCopies: boundedNumber(item.totalCopies),
    availableCopies: boundedNumber(item.availableCopies), copiesWithReaders: boundedNumber(item.copiesWithReaders),
    copiesInReturnCart: boundedNumber(item.copiesInReturnCart), readerProfiles: boundedNumber(item.readerProfiles),
    activeReaderAccounts: boundedNumber(item.activeReaderAccounts), activeSessions: boundedNumber(item.activeSessions),
    completedSessions: boundedNumber(item.completedSessions), totalReadingMinutes: boundedNumber(item.totalReadingMinutes, 100_000_000),
    averageReadingMinutes: boundedNumber(item.averageReadingMinutes, 100_000), activeMemberships: boundedNumber(item.activeMemberships),
    activeQuests: boundedNumber(item.activeQuests), questEnrollments: boundedNumber(item.questEnrollments),
    reportingPeriod: cleanText(item.reportingPeriod, 120) || "current dashboard data",
    questCompletionRate: boundedNumber(item.questCompletionRate, 100),
    topBooks: Array.isArray(item.topBooks) ? item.topBooks.slice(0, 5).flatMap((book): TopBook[] => {
      if (!book || typeof book !== "object") return [];
      const candidate = book as Record<string, unknown>;
      const title = cleanText(candidate.title, 160);
      return title ? [{ title, sessions: boundedNumber(candidate.sessions) }] : [];
    }) : [],
    leastUsedBooks: Array.isArray(item.leastUsedBooks) ? item.leastUsedBooks.slice(0, 5).flatMap((book): TopBook[] => {
      if (!book || typeof book !== "object") return [];
      const candidate = book as Record<string, unknown>; const title = cleanText(candidate.title, 160);
      return title ? [{ title, sessions: boundedNumber(candidate.sessions) }] : [];
    }) : [],
    genreStats: Array.isArray(item.genreStats) ? item.genreStats.slice(0, 10).flatMap((entry): GenreStat[] => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as Record<string, unknown>; const genre = cleanText(candidate.genre, 100);
      return genre ? [{ genre, sessions: boundedNumber(candidate.sessions) }] : [];
    }) : [],
    dailyActivity: Array.isArray(item.dailyActivity) ? item.dailyActivity.slice(-31).flatMap((entry): DailyActivity[] => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as Record<string, unknown>; const day = cleanText(candidate.day, 40);
      return day ? [{ day, sessions: boundedNumber(candidate.sessions), minutes: boundedNumber(candidate.minutes) }] : [];
    }) : [],
  };
}

function allowed(client: string) {
  const now = Date.now();
  const current = buckets.get(client);
  if (!current || current.resetAt <= now) { buckets.set(client, { count: 1, resetAt: now + 60_000 }); return true; }
  if (current.count >= 20) return false;
  current.count += 1;
  return true;
}

function directReply(message: string, context: AnalyticsContext) {
  const q = message.toLowerCase().replace(/[?!.,]/g, "").trim();
  if (/^(hi|hello|hey|good morning|good afternoon|good evening)( bon)?$/.test(q)) return "Hello! I can help you understand Tankobonbon operations, catalog activity, readers, sessions, memberships, and quests.";
  if (/^(who are you|what are you|what can you do|help|help me)( bon)?$/.test(q)) return "I am BON, the Tankobonbon admin analytics assistant. I summarize current library operations and explain the system using the dashboard data available to this librarian session.";
  if (/what is tankobonbon|about tankobonbon|explain tankobonbon/.test(q)) return "Tankobonbon is S.O.R.A.'s library experience for managing the catalog, physical copies, readers, memberships, in-library reading sessions, seats, quests, and rewards. This admin dashboard focuses on daily operations and analytics.";
  if (/analytics summary|reporting period|operations summary|dashboard summary|how are we doing|summarize/.test(q)) return `For ${context.reportingPeriod}, there were ${context.completedSessions.toLocaleString()} completed reading sessions totaling ${context.totalReadingMinutes.toLocaleString()} minutes, with an average of ${context.averageReadingMinutes.toLocaleString()} minutes. Quest completion is ${context.questCompletionRate}%. Current operations show ${context.activeSessions.toLocaleString()} active sessions and ${context.availableCopies.toLocaleString()} available copies.`;
  if (/(how many|total|count).*(member|reader)|(member|reader).*(how many|total|count)/.test(q)) return `There are ${context.readerProfiles.toLocaleString()} registered reader member${context.readerProfiles === 1 ? "" : "s"} in Tankobonbon. ${context.activeReaderAccounts.toLocaleString()} account${context.activeReaderAccounts === 1 ? " is" : "s are"} active, and ${context.activeMemberships.toLocaleString()} currently have an active membership.`;
  if (/(how many|total|count).*(book|title)|(book|title).*(how many|total|count)/.test(q)) return `Tankobonbon currently has ${context.totalTitles.toLocaleString()} catalog title${context.totalTitles === 1 ? "" : "s"} and ${context.totalCopies.toLocaleString()} physical cop${context.totalCopies === 1 ? "y" : "ies"}.`;
  if (/available.*(copy|book)|(copy|book).*available|on shelf/.test(q)) return `${context.availableCopies.toLocaleString()} of ${context.totalCopies.toLocaleString()} physical copies are currently marked available on the shelf.`;
  if (/active.*(session|visit|reader)|(session|visit|reader).*active/.test(q)) return `${context.activeSessions.toLocaleString()} reading session${context.activeSessions === 1 ? " is" : "s are"} active right now. ${context.activeReaderAccounts.toLocaleString()} of ${context.readerProfiles.toLocaleString()} reader accounts are active.`;
  if (/top|popular|most (read|borrowed)|borrowing trend/.test(q)) {
    const top = context.topBooks[0];
    return top ? `${top.title} currently leads with ${top.sessions.toLocaleString()} recorded reading session${top.sessions === 1 ? "" : "s"}.` : "There are no recorded reading sessions yet, so a most-read title cannot be identified.";
  }
  if (/least|unused|underused|not (read|borrowed)/.test(q)) {
    const books = context.leastUsedBooks.slice(0, 5);
    return books.length ? `For ${context.reportingPeriod}, the least-used titles are ${books.map(book => `${book.title} (${book.sessions} sessions)`).join(", ")}.` : `No least-used title data is available for ${context.reportingPeriod}.`;
  }
  if (/genre/.test(q)) {
    const genre = context.genreStats[0];
    return genre ? `${genre.genre} was the most-read genre for ${context.reportingPeriod}, with ${genre.sessions.toLocaleString()} recorded reading session${genre.sessions === 1 ? "" : "s"}.` : `No genre activity is recorded for ${context.reportingPeriod}.`;
  }
  if (/catalog health|healthy.*catalog|catalog.*healthy/.test(q)) return `${context.availableCopies.toLocaleString()} of ${context.totalCopies.toLocaleString()} copies are available, ${context.copiesWithReaders.toLocaleString()} are with readers, and ${context.copiesInReturnCart.toLocaleString()} are awaiting shelving. The catalog contains ${context.totalTitles.toLocaleString()} titles.`;
  if (/membership/.test(q)) return `${context.activeMemberships.toLocaleString()} active membership${context.activeMemberships === 1 ? " is" : "s are"} recorded across ${context.readerProfiles.toLocaleString()} registered reader members.`;
  if (/quest/.test(q)) return `Tankobonbon has ${context.activeQuests.toLocaleString()} active quest${context.activeQuests === 1 ? "" : "s"}, ${context.questEnrollments.toLocaleString()} recorded enrollment${context.questEnrollments === 1 ? "" : "s"}, and a ${context.questCompletionRate}% completion rate.`;
  return null;
}

function memberSearchTerm(message: string) {
  const patterns = [
    /(?:member|reader)\s+named\s+["']?([^"'?]+)["']?/i,
    /(?:do we have|is there|find|search for|look up)\s+(?:a\s+)?(?:member|reader)(?:\s+named)?\s+["']?([^"'?]+)["']?/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1].replace(/[^a-z0-9@._' -]/gi, "").trim().slice(0, 80);
  }
  return "";
}

function asksForMemberDirectory(message: string) {
  const q = message.toLowerCase().replace(/[?!.,]/g, "").trim();
  return /(?:who (?:is|are)|list|show|name|which).*(?:registered )?(?:member|reader)|(?:registered )?(?:member|reader).*(?:list|names|who)/.test(q);
}

type SafeMember = {
  first_name: string;
  last_name: string;
  username: string;
  is_active: boolean;
  membership_status: string;
};

async function memberDirectoryReply(caller: SupabaseClient, message: string) {
  if (!asksForMemberDirectory(message) || memberSearchTerm(message)) return null;
  const result = await caller.schema("sora_v2").from("users")
    .select("first_name,last_name,username,is_active,membership_status", { count: "exact" })
    .eq("user_role", "Reader")
    .order("first_name", { ascending: true })
    .order("last_name", { ascending: true })
    .limit(10);
  if (result.error) {
    console.error("Admin BON member directory failed", result.error.message);
    return "I could not load the member directory right now. Please try again.";
  }
  const members = result.data as SafeMember[];
  const total = result.count ?? members.length;
  if (!total) return "There are currently no registered reader members in Tankobonbon.";
  const names = members.map(member => `${member.first_name} ${member.last_name} (@${member.username})`).join(", ");
  const prefix = total === 1 ? "There is 1 registered reader member" : `There are ${total.toLocaleString()} registered reader members`;
  const remainder = total > members.length ? ` Showing the first ${members.length.toLocaleString()} alphabetically.` : "";
  return `${prefix}: ${names}.${remainder}`;
}

function catalogSearchTerm(message: string) {
  const patterns = [
    /(?:is there|do we have|have we got)\s+(?:a\s+|an\s+|any\s+)?(.+?)\s+(?:book|title)(?:\s+available)?[?!.]*$/i,
    /(?:is there|do we have|have we got)\s+(?:a\s+|an\s+|any\s+)?["']?(.+?)["']?[?!.]*$/i,
    /(?:book|title)\s+(?:named|called|titled)\s+["']?([^"'?]+)["']?/i,
    /(?:find|search for|look up)\s+(?:a\s+|the\s+)?(?:book|title)\s+["']?([^"'?]+)["']?/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      const term = match[1].replace(/[^a-z0-9&._' -]/gi, "").replace(/\s+(book|title)$/i, "").trim().slice(0, 120);
      if (term && !/^(members?|readers?|sessions?|memberships?|quests?|copies|available books?)$/i.test(term)) return term;
    }
  }
  return "";
}

function followUpTerm(message: string) {
  const match = message.match(/^(?:and\s+)?(?:how|what)\s+about\s+(?:a\s+|an\s+|the\s+)?["']?(.+?)["']?[?!.]*$/i);
  return match?.[1] ? match[1].replace(/[^a-z0-9&._' -]/gi, "").replace(/\s+(book|title|member|reader)$/i, "").trim().slice(0, 120) : "";
}

function asksForCatalogTitles(message: string) {
  const q = message.toLowerCase().replace(/[?!.,]/g, "").trim();
  return /(?:what|which).*(?:book )?titles|(?:what is|what are).*(?:title|name).*(?:book|catalog)|(?:list|show|name).*(?:books|titles|catalog)/.test(q);
}

type CatalogBook = {
  title: string;
  volume_number: number | null;
  book_genre: string | null;
  authors: { author_firstname: string; author_lastname: string } | null;
  book_copies: { copy_status: string }[];
};

function describeCatalogBook(book: CatalogBook) {
  const author = book.authors ? `${book.authors.author_firstname} ${book.authors.author_lastname}`.trim() : "unknown author";
  const available = (book.book_copies ?? []).filter(copy => copy.copy_status === "In-Shelf").length;
  const copies = book.book_copies?.length ?? 0;
  const volume = book.volume_number === null ? "" : `, volume ${book.volume_number}`;
  return `${book.title}${volume} by ${author} (${available} of ${copies} copies available)`;
}

async function catalogReply(caller: SupabaseClient, message: string, termOverride = "") {
  const term = termOverride || catalogSearchTerm(message);
  const wantsTitles = asksForCatalogTitles(message);
  if (!term && !wantsTitles) return null;
  let query = caller.schema("sora_v2").from("books")
    .select("title,volume_number,book_genre,authors(author_firstname,author_lastname),book_copies(copy_status)", { count: "exact" })
    .order("title", { ascending: true })
    .limit(10);
  if (term) {
    const pattern = `%${term.replace(/[%_,()]/g, "")}%`;
    query = query.or(`title.ilike.${pattern},original_title.ilike.${pattern},romanized_title.ilike.${pattern}`);
  }
  const result = await query;
  if (result.error) {
    console.error("Admin BON catalog lookup failed", result.error.message);
    return "I could not search the catalog right now. Please try again.";
  }
  const books = result.data as unknown as CatalogBook[];
  const total = result.count ?? books.length;
  if (!books.length) return term ? `No catalog title matching "${term}" was found.` : "There are currently no book titles in the catalog.";
  if (term && books.length === 1) return `Yes. ${describeCatalogBook(books[0])}.`;
  const titles = books.map(book => describeCatalogBook(book)).join("; ");
  const heading = term ? `I found ${total.toLocaleString()} matching title${total === 1 ? "" : "s"}` : `The catalog has ${total.toLocaleString()} title${total === 1 ? "" : "s"}`;
  const remainder = total > books.length ? ` Showing the first ${books.length.toLocaleString()} alphabetically.` : "";
  return `${heading}: ${titles}.${remainder}`;
}

async function memberLookupReply(caller: SupabaseClient, message: string, termOverride = "") {
  const term = termOverride || memberSearchTerm(message);
  if (!term) return null;
  const pattern = `%${term.replace(/[%_,()]/g, "")}%`;
  const result = await caller.schema("sora_v2").from("users")
    .select("first_name,last_name,username,is_active,membership_status")
    .eq("user_role", "Reader")
    .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},username.ilike.${pattern}`)
    .limit(5);
  if (result.error) {
    console.error("Admin BON member lookup failed", result.error.message);
    return "I could not search the member directory right now. Please try again.";
  }
  const members = result.data as { first_name: string; last_name: string; username: string; is_active: boolean; membership_status: string }[];
  if (!members.length) return `I could not find a registered reader member matching “${term}”.`;
  const descriptions = members.map(member => `${member.first_name} ${member.last_name} (@${member.username}), account ${member.is_active ? "active" : "inactive"}, membership ${member.membership_status.toLowerCase()}`);
  return members.length === 1 ? `Yes. ${descriptions[0]} is registered in Tankobonbon.` : `I found ${members.length} matching members: ${descriptions.join("; ")}.`;
}

function guardMessage(message: string) {
  const normalized = message.toLowerCase();
  if (message.length < 2) return "Enter a complete question for BON.";
  if (/ignore (all |the )?(previous|system)|system prompt|developer message|jailbreak|api[_ -]?key|service[_ -]?role|password|drop table|delete from|alter table/.test(normalized)) return "That request cannot be processed by the admin assistant.";
  if (/explicit sexual|porn|how to kill|make a bomb|suicide instructions/.test(normalized)) return "That request is outside the Tankobonbon admin assistant's scope.";
  return null;
}

function parseGenerated(content: unknown) {
  if (typeof content !== "string") return null;
  try {
    const value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Record<string, unknown>;
    return cleanText(value.message, 1_000).replace(/[\u2013\u2014]/g, ",") || null;
  } catch { return null; }
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const authorization = request.headers.get("authorization");
  if (!url || !publishableKey) return NextResponse.json({ error: "Admin AI is not configured." }, { status: 503 });
  if (!authorization?.startsWith("Bearer ")) return NextResponse.json({ error: "Librarian sign-in is required." }, { status: 401 });
  const caller = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const librarian = await caller.schema("sora_v2").rpc("is_librarian");
  if (librarian.error || librarian.data !== true) return NextResponse.json({ error: "Librarian access is required." }, { status: 403 });
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "admin";
  if (!allowed(client)) return NextResponse.json({ error: "BON needs a short rest. Please try again shortly." }, { status: 429 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const message = cleanText(input.message);
  const context = parseContext(input.context);
  if (!message || !context) return NextResponse.json({ error: "Enter a question for BON." }, { status: 400 });
  const rejection = guardMessage(message);
  if (rejection) return NextResponse.json({ error: rejection }, { status: 400 });
  const history = Array.isArray(input.history) ? input.history.slice(-4).flatMap((entry): ChatMessage[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const role = item.role === "user" ? "user" : item.role === "assistant" ? "assistant" : null;
    const content = cleanText(item.content, 500);
    return role && content ? [{ role, content }] : [];
  }) : [];
  const followUp = followUpTerm(message);
  const previousAnswer = [...history].reverse().find(item => item.role === "assistant")?.content.toLowerCase() ?? "";
  if (followUp && /member|reader|account|membership|registered|@/.test(previousAnswer)) {
    const followUpMemberReply = await memberLookupReply(caller, message, followUp);
    if (followUpMemberReply) return NextResponse.json({ message: followUpMemberReply });
  }
  if (followUp && /book|catalog|title|author|volume|cop(?:y|ies)/.test(previousAnswer)) {
    const followUpBookReply = await catalogReply(caller, message, followUp);
    if (followUpBookReply) return NextResponse.json({ message: followUpBookReply });
  }
  const memberReply = await memberLookupReply(caller, message);
  if (memberReply) return NextResponse.json({ message: memberReply });
  const directoryReply = await memberDirectoryReply(caller, message);
  if (directoryReply) return NextResponse.json({ message: directoryReply });
  const bookReply = await catalogReply(caller, message);
  if (bookReply) return NextResponse.json({ message: bookReply });
  const direct = directReply(message, context);
  if (direct) return NextResponse.json({ message: direct });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ message: "I can help with live member counts and names, catalog availability, active reading sessions, memberships, quests, and popular books. Try asking, \"Who are the registered members?\" or \"Give me today's analytics summary.\"" });
  if (openRouterUnavailableUntil > Date.now()) return NextResponse.json({ message: "I can answer live questions about members, book titles and availability, sessions, memberships, quests, and analytics. Try asking me for a specific member or book title." });
  const model = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash-0731";
  const system = `You are BON, the librarian-facing analytics assistant for Tankobonbon, the S.O.R.A. Smart Organized Reading Adventure library system. Focus on Tankobonbon operations, analytics, catalog health, physical-copy availability, readers, memberships, reading sessions, quests, and practical library management. Treat ADMIN ANALYTICS as the only source of current numeric facts. Never invent missing metrics or claim to perform actions. Protect personal data, credentials, secrets, and individual reader details. Politely redirect unrelated questions to Tankobonbon or library operations. Answer the question first in 1 to 4 concise sentences. Never use em dash or en dash characters. Return JSON only: {"message":"..."}.`;
  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://sora-admin-puce.vercel.app", "X-Title": process.env.OPENROUTER_APP_NAME || "Tankobonbon Admin BON" },
      body: JSON.stringify({ model, temperature: 0.25, max_tokens: 220, ...(model.startsWith("deepseek/") ? { reasoning: { enabled: false } } : {}), response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, ...history, { role: "user", content: `ADMIN ANALYTICS: ${JSON.stringify(context)}\nQUESTION: ${message}` }] }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!upstream.ok) {
      console.error("Admin BON OpenRouter request failed", upstream.status, (await upstream.text()).slice(0, 300));
      if (upstream.status === 401 || upstream.status === 403 || upstream.status >= 500) openRouterUnavailableUntil = Date.now() + 10 * 60_000;
      return NextResponse.json({ message: "I can still answer live Tankobonbon questions about member counts and names, catalog availability, sessions, memberships, quests, and popular books. Advanced analysis is temporarily unavailable." });
    }
    const result = await upstream.json() as { choices?: { message?: { content?: unknown } }[] };
    const answer = parseGenerated(result.choices?.[0]?.message?.content);
    return answer ? NextResponse.json({ message: answer }) : NextResponse.json({ error: "BON could not format the analytics response. Please try again." }, { status: 502 });
  } catch (error) {
    console.error("Admin BON request failed", error instanceof Error ? error.message : "Unknown error");
    openRouterUnavailableUntil = Date.now() + 2 * 60_000;
    return NextResponse.json({ message: "I can still answer live questions about members, books, availability, sessions, memberships, quests, and analytics. Please try a specific Tankobonbon question." });
  }
}
