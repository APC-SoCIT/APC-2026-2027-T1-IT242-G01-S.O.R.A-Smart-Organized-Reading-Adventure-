"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BookOpen,
  ChartNoAxesCombined,
  ChevronDown,
  Clock3,
  Edit3,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Trophy,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  database,
  errorMessage,
  usesReplacementSchema,
} from "../../lib/supabase";
import {
  emptyDashboardData,
  loadDashboardData,
  type Book,
  type DashboardData,
  type Visit,
} from "./dashboard-data";
import { AdminBonChat } from "./AdminBonChat";
import { CompleteAddVolume } from "./CompleteAddVolume";
import { EditBookCover } from "./EditBookCover";
import { EditCopyLocation } from "./EditCopyLocation";
import { CatalogueEditor } from "./CatalogueEditor";
import { ReaderCheckIn } from "./ReaderCheckIn";
import { AnalyticsWorkspace } from "./AnalyticsWorkspace";

type Page =
  "Overview" | "Analytics" | "Catalogue" | "Challenges" | "Readers" | "Top-up terminal";
type Data = DashboardData;
const nav: { icon: typeof LayoutDashboard; page: Page; label: string }[] = [
  { icon: LayoutDashboard, page: "Overview", label: "Overview" },
  { icon: ChartNoAxesCombined, page: "Analytics", label: "Analytics" },
  { icon: BookOpen, page: "Catalogue", label: "Book Management" },
  { icon: Trophy, page: "Challenges", label: "Challenges" },
  { icon: Users, page: "Readers", label: "Readers" },
  { icon: Wallet, page: "Top-up terminal", label: "Top-up terminal" },
];
const statusTone: Record<string, string> = {
  "In Shelf": "bg-emerald-50 text-emerald-700 ring-emerald-100",
  "Being Read": "bg-amber-50 text-amber-800 ring-amber-100",
  "With Reader": "bg-amber-50 text-amber-800 ring-amber-100",
  "On Hold": "bg-amber-50 text-amber-800 ring-amber-100",
  "Damaged": "bg-rose-50 text-rose-700 ring-rose-100",
  "No copies": "bg-stone-50 text-stone-700 ring-stone-100",
  "Return Cart": "bg-rose-50 text-rose-700 ring-rose-100",
};
const replacementDb = () => database().schema("sora_v2");
const shelveCopy = (copyId: number) =>
  usesReplacementSchema
    ? replacementDb().rpc("admin_shelve", { p_copy_id: copyId })
    : database().rpc("admin_shelve", { p_copy_id: copyId });
const verifyQuest = (progressId: number) =>
  usesReplacementSchema
    ? replacementDb().rpc("admin_complete_quest", {
        p_user_quest_id: progressId,
      })
    : database().rpc("admin_complete_quest", { p_progress_id: progressId });

export function AdminDashboard() {
  const [data, setData] = useState<Data>(emptyDashboardData);
  const [page, setPage] = useState<Page>("Overview");
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [editingCover, setEditingCover] = useState<Book | null>(null);
  const [editingLocation, setEditingLocation] = useState<Book | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const nextData = await loadDashboardData();
      if (request === generation.current) {
        setData(nextData);
        setError("");
      }
    } catch (cause) {
      if (request === generation.current) setError(errorMessage(cause));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  };
  const run = async (
    action: () => PromiseLike<{ error: unknown }>,
    success: string,
  ) => {
    if (busy) return false;
    setBusy(true);
    try {
      const result = await action();
      if (result.error) throw result.error;
      await refresh();
      notify(success);
      return true;
    } catch (cause) {
      notify(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const name = (id: string | null) => {
    const reader = data.readers.find((item) => item.user_id === id);
    return reader
      ? `${reader.first_name} ${reader.last_name}`
      : "Walk-in visitor";
  };
  const active = data.visits.filter((visit) => visit.status === "ACTIVE");
  const rows = data.books.filter((book) =>
    [book.title, book.author, ...book.book_genres.map((genre) => genre.genre)]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const noticeIsError =
    /not found|error|failed|denied|forbidden|violates|unable|invalid/i.test(
      notice,
    );
  const content =
    page === "Overview" ? (
      <Overview data={data} setPage={setPage} name={name} run={run} />
    ) : page === "Analytics" ? (
      <AnalyticsWorkspace data={data} />
    ) : page === "Catalogue" ? (
      <CatalogueEditor
        rows={rows}
        data={data}
        query={query}
        setQuery={setQuery}
        setDrawer={setDrawer}
        setEditingCover={setEditingCover}
        setEditingLocation={setEditingLocation}
      />
    ) : page === "Challenges" ? (
      <Challenges data={data} name={name} run={run} />
    ) : page === "Readers" ? (
      <Readers data={data} active={active} name={name} run={run} />
    ) : (
      <TopUp data={data} name={name} run={run} />
    );
  return (
    <main className="admin-shell min-h-screen text-[#543822]">
      <div className="relative z-10 flex min-h-screen">
        <aside
          aria-hidden={!navOpen}
          className={`admin-drawer sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden text-[#f8eddc] transition-[width] duration-300 ease-in-out ${navOpen ? "w-[290px]" : "w-0"}`}
        >
          <div className="flex h-16 w-[290px] shrink-0 items-center justify-between border-b border-white/10 px-4">
            <Logo />
            <button
              onClick={() => setNavOpen(false)}
              aria-label="Close navigation menu"
              className="grid h-9 w-9 place-items-center rounded-xl text-[#543822] transition hover:bg-white/60"
            >
              <X size={18} />
            </button>
          </div>
          <nav
            className="flex-1 space-y-1.5 overflow-y-auto px-4 py-6"
            style={{ width: 290 }}
          >
            <p className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[.22em] text-[#c9a06f]">
              Workspace
            </p>
            {nav.map(({ icon: Icon, page: itemPage, label }) => (
              <button
                key={itemPage}
                onClick={() => setPage(itemPage)}
                className={`admin-nav-item group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${page === itemPage ? "is-active bg-[#f9d219] text-[#543822] shadow-[0_6px_18px_rgba(249,210,25,.35)]" : "text-[#543822] hover:bg-white/60"}`}
              >
                <span
                  className={`grid h-8 w-8 place-items-center rounded-lg transition ${page === itemPage ? "bg-[#543822]/15 text-[#543822]" : "bg-[#543822]/10 text-[#543822] group-hover:bg-[#543822]/15"}`}
                >
                  <Icon size={16} />
                </span>
                {label}
              </button>
            ))}
          </nav>
          <div className="w-[290px] border-t border-white/10 p-4">
            <button
              onClick={() =>
                void run(() => database().auth.signOut(), "Signed out")
              }
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-[#543822] transition hover:bg-white/60"
            >
              <LogOut size={18} />
              Sign out
            </button>
          </div>
        </aside>
        <section className="min-w-0 flex-1">
          <header className="admin-topbar sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[#eadfd3] bg-[#fefefd]/85 px-4 backdrop-blur-xl sm:px-6">
            {!navOpen && (
              <>
                <button
                  onClick={() => setNavOpen((value) => !value)}
                  aria-label="Open navigation menu"
                  aria-expanded={navOpen}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#eadfd3] bg-white/70 text-[#543822] transition hover:border-[#c4800c]/40 hover:bg-[#f3d793]/40 active:scale-95"
                >
                  <Menu size={19} />
                </button>
                <Logo />
              </>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => void refresh()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-[#eadfd3] bg-white/70 px-3.5 py-2 text-xs font-semibold text-[#543822] transition hover:border-[#c4800c]/40 hover:bg-[#f3d793]/40 disabled:opacity-50"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
              <button
                onClick={() =>
                  void run(() => database().auth.signOut(), "Signed out")
                }
                className="inline-flex items-center gap-2 rounded-xl bg-[#953410] px-3.5 py-2 text-xs font-bold text-[#fefefd] shadow-[0_4px_14px_rgba(149,52,16,.3)] transition hover:bg-[#7c2b0c] active:scale-95"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          </header>
          <div className="mx-auto max-w-[1440px] p-5 sm:p-8 lg:p-10">
            <div className="mb-8 flex flex-col gap-4 border-b border-[#c4800c]/25 pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.24em] text-[#953410]">
                  <span className="h-px w-6 bg-[#c4800c]" />
                  {page === "Catalogue" ? "Book Management" : page}
                </p>
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#543822] sm:text-4xl">
                  {page === "Overview" ? "Reading Room Today" : page}
                </h1>
              </div>
              <button className="inline-flex w-fit items-center gap-2 rounded-full border border-[#c4800c]/30 bg-[#fefefd] px-4 py-2 text-xs font-semibold text-[#543822] shadow-sm">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Station online <ChevronDown size={14} />
              </button>
            </div>
            {error && (
              <div
                role="alert"
                className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
              >
                {error}
              </div>
            )}
            {notice && (
              <div
                role={noticeIsError ? "alert" : "status"}
                aria-live="polite"
                className={`fixed right-5 top-5 z-[70] flex max-w-sm items-center gap-3 rounded-2xl px-5 py-4 text-sm font-bold shadow-[0_18px_50px_rgba(63,35,18,.28)] ${noticeIsError ? "border border-rose-300 bg-rose-50 text-rose-800" : "border border-[#d9b56f] bg-[#fffaf0] text-[#6f3a18]"}`}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-white ${noticeIsError ? "bg-rose-600" : "bg-emerald-600"}`}
                >
                  {noticeIsError ? "!" : "✓"}
                </span>
                {notice}
              </div>
            )}
            {content}
          </div>
        </section>
        {drawer && (
          <CompleteAddVolume
            data={data}
            close={() => setDrawer(false)}
            run={run}
          />
        )}{" "}
        {editingCover && (
          <EditBookCover
            book={editingCover}
            close={() => setEditingCover(null)}
            run={run}
          />
        )}
        {editingLocation && <EditCopyLocation book={editingLocation} copies={data.copies.filter(copy => copy.book_id === editingLocation.book_id)} close={() => setEditingLocation(null)} run={run} />}
        <AdminBonChat data={data} />
      </div>
    </main>
  );
}

function Logo() {
  return (
    <div className="admin-logo">
      <img src="/logo_line_200x@2x.png" alt="Tankobonbon Manga Library" />
    </div>
  );
}
function SectionTitle({ title, copy }: { title: string; copy?: string }) {
  return (
    <div>
      <h2 className="font-serif text-xl font-semibold text-[#543822]">
        {title}
      </h2>
      {copy && <p className="mt-1 text-xs text-[#8d735e]">{copy}</p>}
    </div>
  );
}
function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl bg-[#953410] px-4 py-2.5 text-xs font-bold text-[#fefefd] shadow-[0_4px_14px_rgba(149,52,16,.28)] transition hover:bg-[#7c2b0c] active:scale-95 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
function bookStatus(book: Book) {
  const statuses = book.book_copies.map((copy) => copy.status);
  if (statuses.includes("IN_SHELF")) return "In Shelf";
  if (statuses.includes("WITH_READER")) return "With Reader";
  if (statuses.includes("On Hold")) return "On Hold";
  if (statuses.includes("RETURN_CART")) return "Return Cart";
  if (statuses.includes("Damaged")) return "Damaged";
  return "No copies";
}

function Overview({
  data,
  setPage,
  name,
  run,
}: {
  data: Data;
  setPage: (page: Page) => void;
  name: (id: string | null) => string;
  run: (
    action: () => PromiseLike<{ error: unknown }>,
    success: string,
  ) => Promise<boolean>;
}) {
  const returned = data.copies.filter((copy) => copy.status === "RETURN_CART");
  const leaders = [...data.books]
    .map((book) => ({
      book,
      reads: data.logs.filter((log) => log.book_id === book.book_id).length,
    }))
    .sort((a, b) => b.reads - a.reads)
    .slice(0, 5);
  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[1.35fr_.95fr]">
        <section className="admin-hero-card relative overflow-hidden rounded-3xl p-6 text-[#fefefd] shadow-[0_20px_50px_rgba(84,56,34,.35)] sm:p-8">
          <div
            className="admin-hero-orb admin-hero-orb-one"
            aria-hidden="true"
          />
          <div
            className="admin-hero-orb admin-hero-orb-two"
            aria-hidden="true"
          />
          <div className="admin-hero-sheen" aria-hidden="true" />
          <div className="relative flex items-start justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.22em] text-[#f9d219]">
                On the floor
              </p>
              <strong className="mt-3 block font-serif text-6xl leading-none drop-shadow-[0_4px_12px_rgba(0,0,0,.35)]">
                {
                  data.copies.filter((copy) => copy.status === "WITH_READER")
                    .length
                }
              </strong>
              <p className="mt-2 text-sm text-[#efd9bd]">
                volumes in readers’ hands
              </p>
            </div>
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[10px] font-semibold backdrop-blur">
              Live now
            </span>
          </div>
          <div className="relative mt-10 flex h-24 items-end gap-3">
            {leaders.map(({ reads }, index) => (
              <div
                key={index}
                className={`w-8 rounded-t-md shadow-[0_-2px_10px_rgba(0,0,0,.2)] transition-all duration-500 ${index === 0 ? "bg-gradient-to-t from-[#c4800c] to-[#f9d219]" : "bg-gradient-to-t from-[#953410]/70 to-[#efce8e]/80"}`}
                style={{ height: `${Math.max(12, Math.min(96, reads * 12))}%` }}
              />
            ))}
          </div>
        </section>
        <section className="admin-card rounded-2xl border border-[#eadfd3] bg-[#fefefd] p-5 shadow-[0_8px_24px_rgba(84,56,34,.07)] sm:p-6">
          <div className="space-y-1">
            {[
              [
                "Active readers",
                data.visits.filter((visit) => visit.status === "ACTIVE").length,
              ],
              ["Return cart", returned.length],
              ["Checkouts", data.logs.length],
            ].map(([label, value]) => (
              <div
                className="flex items-center justify-between border-b border-[#f0e7da] py-4 text-sm text-[#543822]"
                key={String(label)}
              >
                <span>{label}</span>
                <b className="font-serif text-2xl">{value}</b>
              </div>
            ))}
          </div>
          <button
            onClick={() => setPage("Analytics")}
            className="admin-cta group mt-5 flex w-full items-center justify-between overflow-hidden rounded-xl px-4 py-3.5 text-xs font-bold text-[#543822] shadow-[0_8px_20px_rgba(196,128,12,.35)]"
          >
            <span className="relative z-10 flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-[#543822]/15 transition group-hover:rotate-12">
                ✦
              </span>
              View full analytics
            </span>
            <span className="relative z-10 flex items-center gap-1 transition group-hover:translate-x-1">
              Open <span aria-hidden="true">→</span>
            </span>
          </button>
        </section>
      </div>
      <div className="mt-8 grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-2xl border border-[#e8dfd3] bg-[#fffdf9] p-5 shadow-sm sm:p-6">
          <SectionTitle
            title="Most read this month"
            copy="Titles generating the most reading sessions."
          />
          <div className="mt-6 space-y-4">
            {leaders.map(({ book, reads }, index) => (
              <div
                className="grid grid-cols-[22px_minmax(0,1fr)_100px_35px] items-center gap-3 text-xs"
                key={book.book_id}
              >
                <span className="font-serif text-[#b66a3c]">{index + 1}</span>
                <div className="min-w-0">
                  <b className="block truncate">{book.title}</b>
                  <small className="text-[#9a806b]">
                    {book.author ?? "Unknown author"}
                  </small>
                </div>
                <div className="h-1.5 rounded-full bg-[#f0e5d9]">
                  <div
                    className="h-full rounded-full bg-[#b24419]"
                    style={{
                      width: `${leaders[0]?.reads ? (reads / leaders[0].reads) * 100 : 0}%`,
                    }}
                  />
                </div>
                <b>{reads}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-[#e8dfd3] bg-[#fffdf9] p-5 shadow-sm sm:p-6">
          <SectionTitle
            title="Needs shelving"
            copy="Returned titles awaiting inspection."
          />
          <div className="mt-6 space-y-3">
            {returned.map((copy) => (
              <button
                key={copy.copy_id}
                onClick={() =>
                  void run(
                    () => shelveCopy(copy.copy_id),
                    "Copy returned to shelf",
                  )
                }
                className="flex w-full items-center justify-between rounded-xl border border-[#eee2d6] p-3 text-left text-xs hover:border-[#cfac8d]"
              >
                <span>
                  <b className="block">
                    {data.books.find((book) => book.book_id === copy.book_id)
                      ?.title ?? "Book"}
                  </b>
                  <small className="text-[#9a806b]">
                    {copy.identifier_value} · return cart
                  </small>
                </span>
                <Edit3 size={15} className="text-[#a83d12]" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Catalogue({
  rows,
  data,
  query,
  setQuery,
  setDrawer,
  run,
}: {
  rows: Book[];
  data: Data;
  query: string;
  setQuery: (value: string) => void;
  setDrawer: (value: boolean) => void;
  run: (
    action: () => PromiseLike<{ error: unknown }>,
    success: string,
  ) => Promise<boolean>;
}) {
  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          ["Total titles", data.books.length],
          [
            "In shelf",
            data.copies.filter((copy) => copy.status === "IN_SHELF").length,
          ],
          [
            "Needs action",
            data.copies.filter((copy) => copy.status === "RETURN_CART").length,
          ],
        ].map(([label, value]) => (
          <div
            className="rounded-2xl border border-[#e8dfd3] bg-[#fffdf9] p-4 shadow-sm"
            key={String(label)}
          >
            <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#9a806b]">
              {label}
            </p>
            <b className="mt-2 block font-serif text-3xl">{value}</b>
          </div>
        ))}
      </div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-[#e2d5c8] bg-white px-3 shadow-sm">
          <Search size={16} className="text-[#9a806b]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full bg-transparent py-3 text-sm outline-none"
            placeholder="Search title, author, or genre"
          />
        </label>
        <ActionButton onClick={() => setDrawer(true)}>
          <Plus size={15} />
          Add volume
        </ActionButton>
      </div>
      <section className="overflow-hidden rounded-2xl border border-[#e8dfd3] bg-[#fffdf9] shadow-sm">
        <div className="flex items-center justify-between border-b border-[#eee5dc] px-5 py-4">
          <SectionTitle
            title="Every volume on record"
            copy={`${rows.length} matching record${rows.length === 1 ? "" : "s"}`}
          />
          <span className="hidden rounded-lg bg-[#fff0c9] px-2 py-1 text-[10px] font-bold text-[#804916] sm:block">
            Live inventory
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="bg-[#fcf8f2] text-[10px] font-bold uppercase tracking-[.12em] text-[#9a806b]">
              <tr>
                <th className="px-5 py-3">Volume</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Genre</th>
                <th className="px-4 py-3">Reads</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((book) => {
                const status = bookStatus(book);
                return (
                  <tr
                    key={book.book_id}
                    className="border-t border-[#f0e9e1] hover:bg-[#fffbf5]"
                  >
                    <td className="px-5 py-4">
                      <b className="block">{book.title}</b>
                      <small className="mt-1 block text-[#9a806b]">
                        {book.author ?? "Unknown author"}
                      </small>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${statusTone[status]}`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-[#7e6049]">
                      {book.book_genres
                        .map((genre) => genre.genre)
                        .join(", ") || "—"}
                    </td>
                    <td className="px-4 py-4 font-bold">
                      {
                        data.logs.filter((log) => log.book_id === book.book_id)
                          .length
                      }
                    </td>
                    <td className="px-5 py-4 text-right">
                      {status === "Return Cart" && (
                        <button
                          onClick={() => {
                            const copy = book.book_copies.find(
                              (item) => item.status === "RETURN_CART",
                            );
                            if (copy)
                              void run(
                                () => shelveCopy(copy.copy_id),
                                "Copy returned to shelf",
                              );
                          }}
                          className="font-bold text-[#a83d12] hover:underline"
                        >
                          Shelve
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function AddVolume({
  data,
  close,
  run,
}: {
  data: Data;
  close: () => void;
  run: (
    action: () => PromiseLike<{ error: unknown }>,
    success: string,
  ) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [barcode, setBarcode] = useState("");
  const [shelf, setShelf] = useState("");
  return (
    <div className="fixed inset-0 z-20 bg-[#2d190c]/30 backdrop-blur-sm">
      <aside
        role="dialog"
        aria-modal="true"
        className="absolute right-0 top-0 flex h-full w-full max-w-[390px] flex-col bg-[#fffdf9] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#eee2d6] p-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#b66a3c]">
              Catalogue
            </p>
            <h2 className="mt-1 font-serif text-2xl">Add a volume</h2>
          </div>
          <button
            onClick={close}
            aria-label="Close add volume panel"
            className="rounded-xl p-2 hover:bg-[#f5ecdf]"
          >
            <X size={18} />
          </button>
        </div>
        <form
          className="flex flex-1 flex-col overflow-y-auto p-6"
          onSubmit={async (event) => {
            event.preventDefault();
            const inserted = await run(
              () =>
                database()
                  .from("books")
                  .insert({
                    title,
                    author: author || null,
                    acquisition_status: "IN_LIBRARY",
                  })
                  .select("book_id")
                  .single(),
              "Volume created",
            );
            if (inserted && barcode) {
              const latest = await database()
                .from("books")
                .select("book_id")
                .eq("title", title)
                .order("book_id", { ascending: false })
                .limit(1)
                .single();
              if (!latest.error)
                await run(
                  () =>
                    database()
                      .from("book_copies")
                      .insert({
                        book_id: latest.data.book_id,
                        identifier_value: barcode,
                        identifier_type: "BARCODE",
                        shelf_id: shelf ? Number(shelf) : null,
                      }),
                  "Physical copy added",
                );
            }
            close();
          }}
        >
          <label className="mt-4 block text-[10px] font-bold uppercase tracking-[.12em] text-[#795a42]">
            Title
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#e2d5c8] bg-[#fffbf5] px-3 py-3 text-sm font-normal normal-case"
            />
          </label>
          <label className="mt-4 block text-[10px] font-bold uppercase tracking-[.12em] text-[#795a42]">
            Author
            <input
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#e2d5c8] bg-[#fffbf5] px-3 py-3 text-sm font-normal normal-case"
            />
          </label>
          <label className="mt-4 block text-[10px] font-bold uppercase tracking-[.12em] text-[#795a42]">
            Barcode (optional)
            <input
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#e2d5c8] bg-[#fffbf5] px-3 py-3 text-sm font-normal normal-case"
            />
          </label>
          <label className="mt-4 block text-[10px] font-bold uppercase tracking-[.12em] text-[#795a42]">
            Shelf
            <select
              value={shelf}
              onChange={(event) => setShelf(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#e2d5c8] bg-[#fffbf5] px-3 py-3 text-sm font-normal normal-case"
            >
              <option value="">No shelf</option>
              {data.shelves.map((item) => (
                <option key={item.shelf_id} value={item.shelf_id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-auto border-t border-[#eee2d6] pt-6">
            <ActionButton onClick={() => {}}>
              <Plus size={15} />
              Create volume
            </ActionButton>
          </div>
        </form>
      </aside>
    </div>
  );
}

function Challenges({
  data,
  name,
  run,
}: {
  data: Data;
  name: (id: string | null) => string;
  run: (
    action: () => PromiseLike<{ error: unknown }>,
    success: string,
  ) => Promise<boolean>;
}) {
  const [composer, setComposer] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [points, setPoints] = useState("0");
  const [difficulty, setDifficulty] = useState("Easy");
  const [targetGenre, setTargetGenre] = useState("");
  const [questFilter, setQuestFilter] = useState("All");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState("");
  async function suggestQuest() {
    setAiBusy(true);
    setAiNote("");
    try {
      const { data: sessionData } = await database().auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Librarian sign-in is required.");
      const response = await fetch("/api/quest-suggestion", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ difficulty }) });
      const payload = await response.json() as { draft?: { title: string; description: string; requirement: string; difficulty: string; targetGenre: string; points: number; timeLimitDays: number; rationale: string }; source?: string; error?: string };
      if (!response.ok || !payload.draft) throw new Error(payload.error || "A quest draft could not be generated.");
      setTitle(payload.draft.title); setDescription(payload.draft.requirement); setDifficulty(payload.draft.difficulty); setTargetGenre(payload.draft.targetGenre); setPoints(String(payload.draft.points));
      setAiNote(`${payload.source === "ai" ? "AI draft" : "Safe template"}: ${payload.draft.rationale} Review before saving.`);
    } catch (cause) { setAiNote(errorMessage(cause)); } finally { setAiBusy(false); }
  }
  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <p className="text-sm text-[#806b59]">
          Monitor verified quest progress and reward eligibility.
        </p>
        <div className="flex flex-wrap gap-2"><select value={questFilter} onChange={(event) => setQuestFilter(event.target.value)} className="rounded-xl border border-[#e2d5c8] bg-white px-3 py-2 text-sm" aria-label="Filter quests by difficulty"><option>All</option><option>Easy</option><option>Medium</option><option>Hard</option></select><ActionButton onClick={() => setComposer((value) => !value)}><Plus size={15} />Create quest</ActionButton></div>
      </div>
      {composer && (
        <form
          className="mb-6 grid gap-3 rounded-2xl border border-[#e8dfd3] bg-[#fffdf9] p-5 sm:grid-cols-2 lg:grid-cols-6"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await run(
                () =>
                  usesReplacementSchema
                    ? replacementDb().rpc("admin_create_quest", {
                        p_name: title,
                        p_difficulty: difficulty,
                        p_description: description,
                        p_requirement: description,
                        p_points: Number(points),
                        p_target_genre: targetGenre || null,
                      })
                    : database()
                        .from("quests")
                        .insert({
                          name: title,
                          description,
                          quest_type: "SIDE",
                          requirement_type: "STAFF_VERIFIED",
                          points_reward: Number(points),
                          status: "ACTIVE",
                        }),
                "Quest created",
              )
            ) {
              setComposer(false);
              setTitle("");
              setDescription("");
            }
          }}
        >
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Quest title"
            className="rounded-xl border p-3 text-sm"
          />
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} className="rounded-xl border p-3 text-sm" aria-label="Quest difficulty"><option>Easy</option><option>Medium</option><option>Hard</option></select>
          <input value={targetGenre} onChange={(event) => setTargetGenre(event.target.value)} placeholder="Target genre" className="rounded-xl border p-3 text-sm" />
          <input
            required
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Requirements"
            className="rounded-xl border p-3 text-sm"
          />
          <input
            required
            type="number"
            min="0"
            value={points}
            onChange={(event) => setPoints(event.target.value)}
            placeholder="Points"
            className="rounded-xl border p-3 text-sm"
          />
          <ActionButton onClick={() => {}}>Save quest</ActionButton>
          <button type="button" disabled={aiBusy} onClick={() => void suggestQuest()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#c9863c] bg-[#fff7eb] px-4 py-3 text-sm font-semibold text-[#8f3c12] disabled:opacity-50"><Sparkles size={15}/>{aiBusy ? "Drafting..." : "Draft with AI"}</button>
          {aiNote && <p className="sm:col-span-2 lg:col-span-6 text-xs leading-5 text-[#71543d]" role="status">{aiNote}</p>}
        </form>
      )}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {data.quests.filter((quest) => questFilter === "All" || quest.quest_type.toLowerCase() === questFilter.toLowerCase()).map((quest) => {
          const pending = data.enrollments.filter(
            (item) =>
              item.quest_id === quest.quest_id &&
              ["ACTIVE", "PENDING"].includes(item.status),
          );
          return (
            <article
              className="rounded-2xl border border-[#e8dfd3] bg-[#fffdf9] p-5 shadow-sm"
              key={quest.quest_id}
            >
              <div className="flex items-start justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff0c9] text-lg text-[#a65b1e]">
                  ★
                </span>
                {!usesReplacementSchema && (
                  <button
                    onClick={() =>
                      void run(
                        () =>
                          database()
                            .from("quests")
                            .update({
                              status:
                                quest.status === "ACTIVE"
                                  ? "ARCHIVED"
                                  : "ACTIVE",
                            })
                            .eq("quest_id", quest.quest_id)
                            .select()
                            .single(),
                        `Quest ${quest.status === "ACTIVE" ? "archived" : "activated"}`,
                      )
                    }
                    className="rounded-lg p-2 text-[#a83d12] hover:bg-[#fce8d8]"
                  >
                    <Edit3 size={15} />
                  </button>
                )}
              </div>
              <p className="mt-6 font-serif text-xl font-semibold">
                {quest.name}
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[.15em] text-[#b66a3c]">
                {quest.quest_type} · {quest.status}
              </p>
              <p className="mt-5 text-xs text-[#71543d]">{quest.description}</p>
              <p className="mt-4 text-xs font-bold text-[#a83d12]">
                {quest.points_reward} points
              </p>
              <div className="mt-5 space-y-2">
                {pending.map((item) => (
                  <button
                    key={item.quest_progress_id}
                    onClick={() =>
                      void run(
                        () => verifyQuest(item.quest_progress_id),
                        "Quest completion verified",
                      )
                    }
                    className="block w-full rounded-lg border border-[#e2d5c8] px-3 py-2 text-left text-xs hover:bg-[#fff5e8]"
                  >
                    Verify {name(item.user_id)}
                  </button>
                ))}
                {!pending.length && (
                  <small className="text-[#8d735e]">
                    No completions awaiting verification.
                  </small>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function Readers({
  data,
  active,
  name,
  run,
}: {
  data: Data;
  active: Visit[];
  name: (id: string | null) => string;
  run: (
    action: () => PromiseLike<{ error: unknown }>,
    success: string,
  ) => Promise<boolean>;
}) {
  const [search, setSearch] = useState("");
  const [readerId, setReaderId] = useState("");
  const [planId, setPlanId] = useState("");
  const [membershipNumber, setMembershipNumber] = useState("");
  const [rfid, setRfid] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [newReader, setNewReader] = useState({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    username: "",
    birthdate: "",
    mobileNumber: "",
  });
  const readers = data.readers.filter((reader) =>
    `${reader.first_name} ${reader.last_name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const pending = data.readers.filter(
    (reader) =>
      reader.is_active &&
      reader.roles?.name === "reader" &&
      !data.memberAccounts.some(
        (item) => item.user_id === reader.user_id && item.status === "ACTIVE",
      ),
  );
  const plans = usesReplacementSchema
    ? data.plans
    : data.plans.filter((plan) => plan.entry_type !== "WALK_IN");
  const selectedPlan = plans.find(
    (plan) => String(plan.membership_type_id) === planId,
  );
  return (
    <>
      {usesReplacementSchema && <ReaderCheckIn />}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-[#e2d5c8] bg-white px-3 shadow-sm">
          <Search size={16} className="text-[#9a806b]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full bg-transparent py-3 text-sm outline-none"
            placeholder="Search reader"
          />
        </label>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {[
          [
            "Registered readers",
            data.readers.filter((reader) => reader.roles?.name === "reader")
              .length,
          ],
          ["Awaiting activation", pending.length],
          ["Reading now", active.length],
          [
            "Active memberships",
            data.memberAccounts.filter((item) => item.status === "ACTIVE").length,
          ],
        ].map(([label, value]) => (
          <div
            className="rounded-2xl border border-[#e8dfd3] bg-[#fffdf9] p-5 shadow-sm"
            key={String(label)}
          >
            <p className="text-[11px] font-semibold text-[#8d735e]">{label}</p>
            <b className="mt-2 block font-serif text-3xl">{value}</b>
          </div>
        ))}
      </div>
      {usesReplacementSchema && (
        <section className="mb-6 rounded-2xl border border-[#e8dfd3] bg-[#fffdf9] p-5 shadow-sm sm:p-6">
          <SectionTitle
            title="Create reader account"
            copy="Create the reader's secure login and exact-ERD user record together."
          />
          <form
            className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await run(async () => {
                const session = await database().auth.getSession();
                const token = session.data.session?.access_token;
                if (!token)
                  return { error: new Error("Librarian session expired.") };
                const response = await fetch("/api/readers", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify(newReader),
                });
                const result = (await response.json()) as { error?: string };
                return {
                  error: response.ok
                    ? null
                    : new Error(
                        result.error ?? "Reader account could not be created.",
                      ),
                };
              }, "Reader login and profile created");
              if (ok)
                setNewReader({
                  email: "",
                  password: "",
                  firstName: "",
                  lastName: "",
                  username: "",
                  birthdate: "",
                  mobileNumber: "",
                });
            }}
          >
            {(
              [
                ["First name", "firstName", "text"],
                ["Last name", "lastName", "text"],
                ["Username", "username", "text"],
                ["Birthdate", "birthdate", "date"],
                ["Mobile number", "mobileNumber", "tel"],
                ["Email", "email", "email"],
                ["Temporary password", "password", "password"],
              ] as const
            ).map(([label, key, type]) => (
              <label
                key={key}
                className="text-[10px] font-bold uppercase tracking-[.12em] text-[#795a42]"
              >
                {label}
                <input
                  required
                  type={type}
                  minLength={key === "password" ? 12 : undefined}
                  value={newReader[key]}
                  onChange={(event) =>
                    setNewReader((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-[#e2d5c8] bg-[#fffbf5] px-3 py-3 text-sm font-normal normal-case"
                />
              </label>
            ))}
            <div className="flex items-end">
              <ActionButton onClick={() => {}}>
                <Plus size={15} />
                Create reader
              </ActionButton>
            </div>
          </form>
        </section>
      )}
      <section className="mb-6 rounded-2xl border border-[#e8dfd3] bg-[#fffdf9] p-5 shadow-sm sm:p-6">
        <SectionTitle
          title="Activate reader account"
          copy="Verify their identity and physical card in person before activation."
        />
        <form
          className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await run(
                () =>
                  usesReplacementSchema
                    ? replacementDb().rpc("admin_activate_membership", {
                        p_user_id: readerId,
                        p_membership_type: selectedPlan?.name,
                        p_membership_rank: "F",
                        p_remaining_minutes: 0,
                        p_expires_at: new Date(expiresAt).toISOString(),
                        p_rfid: rfid.trim() || null,
                      })
                    : database().rpc("admin_activate_member", {
                        p_user_id: readerId,
                        p_type_id: Number(planId),
                        p_number: membershipNumber.trim(),
                        p_rfid: rfid.trim(),
                        p_expires_at: new Date(expiresAt).toISOString(),
                      }),
                "Reader membership and physical card activated",
              )
            ) {
              setReaderId("");
              setPlanId("");
              setMembershipNumber("");
              setRfid("");
              setExpiresAt("");
            }
          }}
        >
          <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#795a42]">
            Reader awaiting activation
            <select
              required
              value={readerId}
              onChange={(event) => setReaderId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#e2d5c8] bg-[#fffbf5] px-3 py-3 text-sm font-normal normal-case"
            >
              <option value="">Select reader</option>
              {pending.map((reader) => (
                <option key={reader.user_id} value={reader.user_id}>
                  {reader.first_name} {reader.last_name}
                  {reader.birthday ? "" : " · birthday required"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#795a42]">
            Membership plan
            <select
              required
              value={planId}
              onChange={(event) => setPlanId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#e2d5c8] bg-[#fffbf5] px-3 py-3 text-sm font-normal normal-case"
            >
              <option value="">Select plan</option>
              {plans.map((plan) => (
                <option
                  key={plan.membership_type_id}
                  value={plan.membership_type_id}
                >
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
          {!usesReplacementSchema && (
            <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#795a42]">
              Membership number
              <input
                required
                value={membershipNumber}
                onChange={(event) => setMembershipNumber(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[#e2d5c8] bg-[#fffbf5] px-3 py-3 text-sm font-normal normal-case"
                placeholder="MEM-000123"
              />
            </label>
          )}
          <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#795a42]">
            Physical RFID UID
            <input
              required
              value={rfid}
              onChange={(event) => setRfid(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#e2d5c8] bg-[#fffbf5] px-3 py-3 text-sm font-normal normal-case"
              placeholder="Scan or enter card UID"
            />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[#795a42]">
            Membership expiry
            <input
              required
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#e2d5c8] bg-[#fffbf5] px-3 py-3 text-sm font-normal normal-case"
            />
          </label>
          <div className="flex items-end">
            <ActionButton onClick={() => {}}>
              <Plus size={15} />
              Activate reader
            </ActionButton>
          </div>
        </form>
        {!pending.length && (
          <p className="mt-4 text-xs text-[#8d735e]">
            No reader accounts are awaiting membership activation.
          </p>
        )}
      </section>
      <section className="overflow-hidden rounded-2xl border border-[#e8dfd3] bg-[#fffdf9] shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="bg-[#fcf8f2] text-[10px] font-bold uppercase tracking-[.12em] text-[#9a806b]">
              <tr>
                <th className="px-5 py-3">Reader</th>
                <th className="px-4 py-3">Membership</th>
                <th className="px-4 py-3">Visit state</th>
                <th className="px-4 py-3">Time balance</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {readers
                .filter((reader) => reader.roles?.name === "reader")
                .map((reader) => {
                  const member = data.memberAccounts.find(
                    (item) =>
                      item.user_id === reader.user_id &&
                      item.status === "ACTIVE",
                  );
                  const visit = active.find(
                    (item) => item.user_id === reader.user_id,
                  );
                  return (
                    <tr
                      className="border-t border-[#f0e9e1] hover:bg-[#fffbf5]"
                      key={reader.user_id}
                    >
                      <td className="px-5 py-4 font-bold">
                        {reader.first_name} {reader.last_name}
                      </td>
                      <td className="px-4 py-4 text-[#80634c]">
                        {member?.membership_label ?? "Awaiting activation"}
                      </td>
                      <td className="px-4 py-4">
                        <span className="rounded-full bg-[#fff0c9] px-2.5 py-1 text-[10px] font-bold text-[#804916]">
                          {!reader.is_active
                            ? "Deactivated"
                            : visit
                              ? "Active session"
                              : "Not checked in"}
                        </span>
                      </td>
                      <td className="px-4 py-4 font-bold">
                        {member?.remaining_minutes == null
                          ? "—"
                          : `${member.remaining_minutes} min`}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {usesReplacementSchema ? (
                          <button
                            disabled={Boolean(visit)}
                            onClick={() =>
                              void run(
                                () =>
                                  replacementDb().rpc("admin_set_user_active", {
                                    p_user_id: reader.user_id,
                                    p_is_active: !reader.is_active,
                                  }),
                                reader.is_active
                                  ? "Reader account deactivated"
                                  : "Reader account reactivated",
                              )
                            }
                            className="font-bold text-[#a83d12] hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                            title={
                              visit
                                ? "End the active reading session first"
                                : undefined
                            }
                          >
                            {visit
                              ? "Reading"
                              : reader.is_active
                                ? "Deactivate"
                                : "Reactivate"}
                          </button>
                        ) : visit ? (
                          <button
                            onClick={() =>
                              void run(
                                () =>
                                  database().rpc("admin_check_out", {
                                    p_visit_id: visit.visit_id,
                                  }),
                                "Reader checked out",
                              )
                            }
                            className="font-bold text-[#a83d12] hover:underline"
                          >
                            Check out
                          </button>
                        ) : (
                          <button
                            disabled={!member}
                            onClick={() =>
                              void run(
                                () =>
                                  database().rpc("admin_check_in", {
                                    p_user_id: reader.user_id,
                                  }),
                                "Reader checked in",
                              )
                            }
                            className="font-bold text-[#a83d12] hover:underline disabled:opacity-40"
                          >
                            Check in
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function TopUp({
  data,
  name,
  run,
}: {
  data: Data;
  name: (id: string | null) => string;
  run: (
    action: () => PromiseLike<{ error: unknown }>,
    success: string,
  ) => Promise<boolean>;
}) {
  const hourly = data.memberAccounts.filter(
    (item) =>
      item.status === "ACTIVE" &&
      item.remaining_minutes !== null &&
      (!usesReplacementSchema ||
        !item.membership_label.startsWith("Guild Adventurer")),
  );
  const [membership, setMembership] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const selected = hourly.find(
    (item) => item.user_id === membership,
  );
  return (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <section className="rounded-2xl border border-[#e8dfd3] bg-[#fffdf9] p-5 shadow-sm sm:p-7">
        <div className="flex min-h-[560px] flex-col items-center justify-center rounded-2xl bg-[#f8f3ec] px-6 text-center">
          <div className="rfid-pulse mb-8 grid h-32 w-32 place-items-center rounded-full bg-[#f3e6d4]">
            <span className="grid h-20 w-20 place-items-center rounded-full bg-[#a83d12] text-[#fff9ef] shadow-xl">
              <Radio size={38} />
            </span>
          </div>
          <h2 className="font-serif text-3xl font-semibold text-[#392414]">
            Top up reading time
          </h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-[#806b59]">
            Select an active hourly membership after scanning or verifying the
            member’s card.
          </p>
          <select
            value={membership}
            onChange={(event) => setMembership(event.target.value)}
            className="mt-6 w-full max-w-md rounded-xl border border-[#e2d5c8] bg-white px-3 py-3 text-sm"
          >
            <option value="">Select membership</option>
            {hourly.map((item) => (
              <option key={item.user_id} value={item.user_id}>
                {item.membership_label} · {name(item.user_id)}
              </option>
            ))}
          </select>
          {selected && (
            <div className="mt-5 w-full max-w-md rounded-2xl border border-[#e8dfd3] bg-white p-5 text-left">
              <p className="text-xs text-[#806b59]">Current balance</p>
              <b className="font-serif text-2xl text-[#a83d12]">
                {selected.remaining_minutes} minutes
              </b>
              <input
                type="number"
                min="1"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                className="mt-5 w-full rounded-xl border border-[#e2d5c8] px-3 py-3 text-sm"
                placeholder="Minutes to add"
              />
              <input
                required
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                className="mt-3 w-full rounded-xl border border-[#e2d5c8] px-3 py-3 text-sm"
                placeholder="Receipt / payment reference"
              />
              {usesReplacementSchema && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="w-full rounded-xl border border-[#e2d5c8] px-3 py-3 text-sm"
                    placeholder="Amount paid"
                  />
                  <select
                    value={method}
                    onChange={(event) => setMethod(event.target.value)}
                    className="w-full rounded-xl border border-[#e2d5c8] px-3 py-3 text-sm"
                  >
                    <option>Cash</option>
                    <option>Gcash</option>
                    <option>Card</option>
                  </select>
                </div>
              )}
              <button
                onClick={() =>
                  void run(
                    () =>
                      replacementDb().rpc("admin_top_up", {
                        p_user_id: selected.user_id,
                        p_minutes: Number(minutes),
                        p_amount: Number(amount),
                        p_method: method,
                        p_reference: reference,
                      }),
                    "Top-up saved",
                  )
                }
                className="mt-4 w-full rounded-xl bg-[#a83d12] px-6 py-3 text-xs font-bold text-white"
              >
                Confirm top-up
              </button>
            </div>
          )}
        </div>
      </section>
      <section className="rounded-2xl border border-[#e8dfd3] bg-[#fffdf9] p-5 shadow-sm sm:p-6">
        <SectionTitle
          title="Active time balances"
          copy="Live membership data"
        />
        <div className="mt-5 space-y-1">
          {hourly.map((item) => (
            <div
              className="flex items-center justify-between border-b border-[#eee5dc] py-4 text-xs"
              key={item.user_id}
            >
              <div>
                <b>{name(item.user_id)}</b>
                <small className="mt-1 block text-[#8d735e]">
                  {item.membership_label}
                </small>
              </div>
              <span className="rounded-full bg-[#fff0c9] px-2.5 py-1 font-bold text-[#804916]">
                {item.remaining_minutes} min
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
