"use client";

import { FormEvent, type ReactNode, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Bot, CalendarDays, Download, FileText, LoaderCircle, Send } from "lucide-react";
import { database, errorMessage } from "../../lib/supabase";
import type { DashboardData } from "./dashboard-data";

type Tab = "Dashboard" | "Usage Reports";
type Preset = "Today" | "7 days" | "30 days" | "Custom";
type BookMetric = { id: number; title: string; author: string; genre: string; sessions: number };
type Analytics = {
  logs: DashboardData["logs"]; visits: DashboardData["visits"]; books: BookMetric[];
  mostUsed: BookMetric[]; leastUsed: BookMetric[]; genres: { genre: string; sessions: number }[];
  daily: { day: string; sessions: number; minutes: number }[]; minutes: number;
  averageMinutes: number; questCompletionRate: number;
};
type ChatMessage = { id: number; from: "bon" | "admin"; text: string };

const startOfDay = (value: Date) => { const next = new Date(value); next.setHours(0, 0, 0, 0); return next; };
const endOfDay = (value: Date) => { const next = new Date(value); next.setHours(23, 59, 59, 999); return next; };
const inputDate = (value: Date) => value.toISOString().slice(0, 10);
const within = (value: string | null, start: Date, end: Date) => { if (!value) return false; const date = new Date(value); return !Number.isNaN(date.getTime()) && date >= start && date <= end; };
const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const genreRules: [string, RegExp][] = [
  ["Action", /\baction\b/i], ["Adventure", /\badventure\b/i], ["Comedy", /\b(comedy|humou?r|funny)\b/i],
  ["Drama", /\bdrama\b/i], ["Fantasy", /\bfantasy\b/i], ["Horror", /\bhorror\b/i],
  ["Mystery", /\b(mystery|detective)\b/i], ["Romance", /\bromance\b/i],
  ["Science Fiction", /\b(science fiction|sci[- ]?fi)\b/i], ["Slice of Life", /\bslice of life\b/i],
  ["Sports", /\bsports?\b/i], ["Historical", /\bhistorical\b/i],
  ["Psychological", /\bpsychological\b/i], ["Supernatural", /\bsupernatural\b/i],
  ["Thriller", /\bthriller\b/i], ["Young Adult", /\byoung adult\b/i],
];
function cleanGenre(raw: string | undefined) {
  if (!raw) return "Uncategorized";
  return genreRules.find(([, pattern]) => pattern.test(raw))?.[0] ?? "Uncategorized";
}

export function AnalyticsWorkspace({ data }: { data: DashboardData }) {
  const today = useMemo(() => new Date(), []);
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [preset, setPreset] = useState<Preset>("30 days");
  const [from, setFrom] = useState(inputDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)));
  const [to, setTo] = useState(inputDate(today));
  const [category, setCategory] = useState("Book usage");
  const [genreFilter, setGenreFilter] = useState("All genres");
  const genreOptions = useMemo(() => [...new Set(data.books.map(book => cleanGenre(book.book_genres[0]?.genre)))].sort(), [data.books]);
  const range = useMemo(() => {
    if (preset === "Custom") return { start: startOfDay(new Date(`${from}T00:00:00`)), end: endOfDay(new Date(`${to}T00:00:00`)) };
    const days = preset === "Today" ? 1 : preset === "7 days" ? 7 : 30;
    return { start: startOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days + 1)), end: endOfDay(today) };
  }, [from, preset, to, today]);

  const analytics = useMemo<Analytics>(() => {
    const matchingBookIds = new Set(data.books.filter(book => genreFilter === "All genres" || cleanGenre(book.book_genres[0]?.genre) === genreFilter).map(book => book.book_id));
    const logs = data.logs.filter(log => within(log.started_at, range.start, range.end) && matchingBookIds.has(log.book_id));
    const visits = data.visits.filter(visit => within(visit.checked_in_at, range.start, range.end));
    const counts = new Map<number, number>();
    logs.forEach(log => counts.set(log.book_id, (counts.get(log.book_id) ?? 0) + 1));
    const books = data.books.filter(book => matchingBookIds.has(book.book_id)).map(book => ({ id: book.book_id, title: book.title, author: book.author ?? "Unknown author", genre: cleanGenre(book.book_genres[0]?.genre), sessions: counts.get(book.book_id) ?? 0 }));
    const mostUsed = [...books].filter(book => book.sessions > 0).sort((a, b) => b.sessions - a.sessions || a.title.localeCompare(b.title)).slice(0, 5);
    const leastUsed = [...books].sort((a, b) => a.sessions - b.sessions || a.title.localeCompare(b.title)).slice(0, 5);
    const genreCounts = new Map<string, number>();
    books.forEach(book => genreCounts.set(book.genre, (genreCounts.get(book.genre) ?? 0) + book.sessions));
    const genres = [...genreCounts].map(([genre, sessions]) => ({ genre, sessions })).filter(item => item.sessions > 0).sort((a, b) => b.sessions - a.sessions).slice(0, 6);
    const days = new Map<string, { sessions: number; minutes: number }>();
    logs.forEach(log => { const key = log.started_at.slice(0, 10); const value = days.get(key) ?? { sessions: 0, minutes: 0 }; value.sessions++; value.minutes += log.total_reading_minutes ?? 0; days.set(key, value); });
    const daily = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day: new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }), ...value }));
    const completed = logs.filter(log => Boolean(log.returned_at));
    const minutes = completed.reduce((sum, log) => sum + (log.total_reading_minutes ?? 0), 0);
    const completedQuests = data.enrollments.filter(item => item.status === "COMPLETED").length;
    return { logs, visits, books, mostUsed, leastUsed, genres, daily, minutes, averageMinutes: completed.length ? Math.round(minutes / completed.length) : 0, questCompletionRate: data.enrollments.length ? Math.round(completedQuests / data.enrollments.length * 100) : 0 };
  }, [data, genreFilter, range]);
  const period = `${range.start.toLocaleDateString()} to ${range.end.toLocaleDateString()}`;

  function exportCsv() {
    const rows: unknown[][] = category === "Reader activity"
      ? [["Reader type", "Check-in", "Status"], ...analytics.visits.map(item => [data.readers.some(reader => reader.user_id === item.user_id) ? "Registered reader" : "Walk-in visitor", item.checked_in_at, item.status])]
      : category === "Quest activity"
        ? [["Quest", "Difficulty", "Status", "Enrollments"], ...data.quests.map(quest => [quest.name, quest.quest_type, quest.status, data.enrollments.filter(item => item.quest_id === quest.quest_id).length])]
        : [["Title", "Author", "Genre", "Reading sessions"], ...analytics.books.map(book => [book.title, book.author, book.genre, book.sessions])];
    const url = URL.createObjectURL(new Blob([rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `sora-${category.toLowerCase().replaceAll(" ", "-")}-${inputDate(range.start)}-${inputDate(range.end)}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 rounded-2xl border border-[#eadfd3] bg-[#fffdf9] p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div><div className="flex gap-2 overflow-x-auto">{(["Dashboard", "Usage Reports"] as Tab[]).map(item => <button key={item} onClick={() => setTab(item)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-bold transition ${tab === item ? "bg-[#953410] text-white shadow-md" : "border border-[#eadfd3] bg-white text-[#71543d] hover:bg-[#fff5e8]"}`}>{item}</button>)}</div><p className="mt-2 text-[11px] text-[#8d735e]">Use the floating BON assistant for analytics questions.</p></div>
      <div className="flex flex-wrap items-center gap-2"><select aria-label="Filter analytics by genre" value={genreFilter} onChange={event => setGenreFilter(event.target.value)} className="max-w-40 rounded-xl border border-[#e2d5c8] bg-white px-3 py-2 text-xs"><option>All genres</option>{genreOptions.map(genre => <option key={genre}>{genre}</option>)}</select><CalendarDays size={15}/><select value={preset} onChange={event => setPreset(event.target.value as Preset)} className="rounded-xl border border-[#e2d5c8] bg-white px-3 py-2 text-xs"><option>Today</option><option>7 days</option><option>30 days</option><option>Custom</option></select>{preset === "Custom" && <><input aria-label="Start date" type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} className="rounded-xl border border-[#e2d5c8] px-3 py-2 text-xs"/><input aria-label="End date" type="date" value={to} min={from} onChange={event => setTo(event.target.value)} className="rounded-xl border border-[#e2d5c8] px-3 py-2 text-xs"/></>}<span className="text-[11px] text-[#8d735e]">{period}</span></div>
    </div>
    {tab === "Dashboard" && <DashboardView data={data} analytics={analytics}/>} 
    {tab === "Usage Reports" && <ReportsView data={data} analytics={analytics} period={period} category={category} setCategory={setCategory} exportCsv={exportCsv}/>} 
  </div>;
}

function DashboardView({ data, analytics }: { data: DashboardData; analytics: Analytics }) {
  const cards = [["Reading sessions", analytics.logs.length], ["Active readers", data.visits.filter(item => item.status === "ACTIVE").length], ["Reading minutes", analytics.minutes], ["Quest completion", `${analytics.questCompletionRate}%`]];
  return <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) => <article key={String(label)} className="rounded-2xl border border-[#eadfd3] bg-[#fffdf9] p-5 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#a65b1e]">{label}</p><strong className="mt-3 block font-serif text-4xl text-[#543822]">{value}</strong></article>)}</div><div className="grid gap-6 xl:grid-cols-2"><ChartCard title="Reading activity" copy="Sessions recorded during the selected period.">{analytics.daily.length ? <ResponsiveContainer width="100%" height={260}><LineChart data={analytics.daily}><CartesianGrid strokeDasharray="3 3" stroke="#eadfd3"/><XAxis dataKey="day" tick={{fontSize:11}}/><YAxis allowDecimals={false} tick={{fontSize:11}}/><Tooltip/><Line type="monotone" dataKey="sessions" stroke="#a83d12" strokeWidth={3}/></LineChart></ResponsiveContainer> : <EmptyChart message="No reading sessions were recorded for these filters."/>}</ChartCard><ChartCard title="Genre activity" copy="Top active genres during the selected period.">{analytics.genres.length ? <ResponsiveContainer width="100%" height={260}><BarChart data={analytics.genres} layout="vertical" margin={{left:12}}><CartesianGrid strokeDasharray="3 3" stroke="#eadfd3"/><XAxis type="number" allowDecimals={false}/><YAxis dataKey="genre" type="category" width={105} tick={{fontSize:11}}/><Tooltip/><Bar dataKey="sessions" fill="#c4800c" radius={[0,6,6,0]}/></BarChart></ResponsiveContainer> : <EmptyChart message="No genre activity was recorded for these filters."/>}</ChartCard></div><div className="grid gap-6 xl:grid-cols-2"><Ranked title="Most read books" rows={analytics.mostUsed}/><Ranked title="Least read books" rows={analytics.leastUsed}/></div></>;
}
function ChartCard({ title, copy, children }: { title: string; copy: string; children: ReactNode }) { return <section className="rounded-2xl border border-[#eadfd3] bg-[#fffdf9] p-5 shadow-sm"><h2 className="font-serif text-xl font-semibold">{title}</h2><p className="mt-1 text-xs text-[#8d735e]">{copy}</p><div className="mt-5">{children}</div></section>; }
function EmptyChart({ message }: { message: string }) { return <div className="grid h-[260px] place-items-center rounded-xl border border-dashed border-[#decdbd] bg-[#fffaf3] px-6 text-center text-sm text-[#8d735e]">{message}</div>; }
function Ranked({ title, rows }: { title: string; rows: BookMetric[] }) { return <section className="rounded-2xl border border-[#eadfd3] bg-[#fffdf9] p-5 shadow-sm"><h2 className="font-serif text-xl font-semibold">{title}</h2><div className="mt-4 divide-y divide-[#eee2d6]">{rows.map((row, index) => <div key={row.id} className="flex items-center gap-3 py-3 text-xs"><b className="w-5 text-[#b66a3c]">{index + 1}</b><span className="min-w-0 flex-1"><b className="block truncate">{row.title}</b><small className="block truncate text-[#9a806b]">{row.genre}</small></span><strong>{row.sessions}</strong></div>)}{!rows.length && <p className="py-8 text-center text-xs text-[#8d735e]">No matching activity is available.</p>}</div></section>; }

function ReportsView({ data, analytics, period, category, setCategory, exportCsv }: { data: DashboardData; analytics: Analytics; period: string; category: string; setCategory: (value: string) => void; exportCsv: () => void }) {
  const rows = category === "Reader activity" ? analytics.visits.map(item => ({ first: data.readers.some(reader => reader.user_id === item.user_id) ? "Registered reader" : "Walk-in visitor", second: new Date(item.checked_in_at).toLocaleString(), third: item.status })) : category === "Quest activity" ? data.quests.map(quest => ({ first: quest.name, second: quest.quest_type, third: `${data.enrollments.filter(item => item.quest_id === quest.quest_id).length} enrollments` })) : analytics.books.map(book => ({ first: book.title, second: `${book.author} · ${book.genre}`, third: `${book.sessions} sessions` }));
  return <section className="rounded-2xl border border-[#eadfd3] bg-[#fffdf9] p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-serif text-2xl font-semibold">Usage report</h2><p className="mt-1 text-xs text-[#8d735e]">{period} · {rows.length} records</p></div><div className="flex flex-wrap gap-2"><select value={category} onChange={event => setCategory(event.target.value)} className="rounded-xl border border-[#e2d5c8] bg-white px-3 py-2 text-xs"><option>Book usage</option><option>Reader activity</option><option>Quest activity</option></select><button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-xl bg-[#953410] px-4 py-2 text-xs font-bold text-white"><Download size={14}/>Export CSV</button><button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl border border-[#c9863c] bg-white px-4 py-2 text-xs font-bold text-[#8f3c12]"><FileText size={14}/>Print / save PDF</button></div></div><div className="mt-6 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead><tr className="border-b border-[#d9c7b6] text-[10px] uppercase tracking-[.14em] text-[#9a6a44]"><th className="px-3 py-3">Record</th><th className="px-3 py-3">Details</th><th className="px-3 py-3">Activity</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.first}-${index}`} className="border-b border-[#f0e7da]"><td className="px-3 py-3 font-semibold">{row.first}</td><td className="px-3 py-3 text-[#806b59]">{row.second}</td><td className="px-3 py-3">{row.third}</td></tr>)}</tbody></table>{!rows.length && <p className="py-12 text-center text-sm text-[#8d735e]">No matching activity exists for this reporting period.</p>}</div></section>;
}

function InsightsView({ data, analytics, period }: { data: DashboardData; analytics: Analytics; period: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 1, from: "bon", text: `I am ready to analyze ${period}. Ask about books, genres, readers, sessions, or quests.` }]);
  const [draft, setDraft] = useState(""); const [busy, setBusy] = useState(false);
  async function ask(question: string) {
    if (busy || !question.trim()) return;
    const history = messages.slice(-6).map(item => ({ role: item.from === "admin" ? "user" : "assistant", content: item.text }));
    setMessages(current => [...current, { id: Date.now(), from: "admin", text: question }]); setDraft(""); setBusy(true);
    try {
      const { data: sessionData } = await database().auth.getSession(); const token = sessionData.session?.access_token; if (!token) throw new Error("Librarian sign-in is required.");
      const context = { totalTitles: data.books.length, totalCopies: data.copies.length, availableCopies: data.copies.filter(item => ["IN_SHELF", "AVAILABLE"].includes(item.status)).length, copiesWithReaders: data.copies.filter(item => item.status === "WITH_READER").length, copiesInReturnCart: data.copies.filter(item => item.status === "RETURN_CART").length, readerProfiles: data.readers.filter(item => item.roles?.name === "reader").length, activeReaderAccounts: data.readers.filter(item => item.roles?.name === "reader" && item.is_active).length, activeSessions: data.visits.filter(item => item.status === "ACTIVE").length, completedSessions: analytics.logs.filter(item => Boolean(item.returned_at)).length, totalReadingMinutes: analytics.minutes, averageReadingMinutes: analytics.averageMinutes, activeMemberships: data.memberAccounts.filter(item => item.status === "ACTIVE").length, activeQuests: data.quests.filter(item => item.status === "ACTIVE").length, questEnrollments: data.enrollments.length, topBooks: analytics.mostUsed.map(item => ({ title: item.title, sessions: item.sessions })), reportingPeriod: period, genreStats: analytics.genres, leastUsedBooks: analytics.leastUsed.map(item => ({ title: item.title, sessions: item.sessions })), dailyActivity: analytics.daily, questCompletionRate: analytics.questCompletionRate };
      const response = await fetch("/api/admin-bon-chat", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ message: question, history, context }) });
      const payload = await response.json() as { message?: string; error?: string }; if (!response.ok || !payload.message) throw new Error(payload.error || "BON could not answer.");
      setMessages(current => [...current, { id: Date.now() + 1, from: "bon", text: payload.message! }]);
    } catch (cause) { setMessages(current => [...current, { id: Date.now() + 1, from: "bon", text: errorMessage(cause) }]); } finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void ask(draft); }
  const suggestions = ["Which genre was most read?", "Show the least-used books", "Summarize this reporting period", "How is quest participation?"];
  return <section className="grid gap-6 xl:grid-cols-[.72fr_1.28fr]"><aside className="rounded-2xl bg-[#59351e] p-6 text-[#fff9ef] shadow-lg"><Bot size={28} className="text-[#f9d219]"/><h2 className="mt-4 font-serif text-2xl font-semibold">AI Insights</h2><p className="mt-2 text-sm leading-6 text-[#e8c9ad]">BON answers from the selected reporting period and current S.O.R.A. records. It will not invent missing metrics.</p><div className="mt-6 space-y-2">{suggestions.map(item => <button key={item} disabled={busy} onClick={() => void ask(item)} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-left text-xs hover:bg-white/10 disabled:opacity-50">{item}</button>)}</div></aside><div className="flex min-h-[520px] flex-col overflow-hidden rounded-2xl border border-[#eadfd3] bg-[#fffdf9] shadow-sm"><header className="border-b border-[#eadfd3] px-5 py-4"><b className="text-sm">BON analytics conversation</b><p className="text-[11px] text-[#8d735e]">{period}</p></header><div className="flex-1 space-y-3 overflow-y-auto p-5">{messages.map(item => <p key={item.id} className={`w-fit max-w-[84%] rounded-2xl px-4 py-3 text-sm leading-6 ${item.from === "bon" ? "border border-[#eadfd3] bg-[#fff7eb]" : "ml-auto bg-[#a83d12] text-white"}`}>{item.text}</p>)}{busy && <p className="flex w-fit items-center gap-2 rounded-2xl bg-[#fff7eb] px-4 py-3 text-sm"><LoaderCircle size={14} className="animate-spin"/>Analyzing verified records...</p>}</div><form onSubmit={submit} className="flex gap-2 border-t border-[#eadfd3] bg-white p-4"><input value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} maxLength={800} placeholder="Ask an analytics question..." className="min-w-0 flex-1 rounded-xl border border-[#e2d5c8] px-3 py-2.5 text-sm outline-none focus:border-[#a83d12]"/><button disabled={busy || !draft.trim()} className="grid h-11 w-11 place-items-center rounded-xl bg-[#a83d12] text-white disabled:opacity-50" aria-label="Send"><Send size={16}/></button></form></div></section>;
}
