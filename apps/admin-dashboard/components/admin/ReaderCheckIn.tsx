"use client";

import { useEffect, useRef, useState } from "react";
import { database, errorMessage } from "../../lib/supabase";

type ReaderCard = { is_active: boolean; deactivated_at: string | null; users: { first_name: string; last_name: string; username: string; birthdate: string; is_active: boolean; user_role: string; membership_status: string; membership_expires_at: string | null } };
type Alert = { log_id: number; details: string; created_at: string };
const api = () => database().schema("sora_v2");

export function ReaderCheckIn() {
  const [rfid, setRfid] = useState("");
  const [card, setCard] = useState<ReaderCard | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertError, setAlertError] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const mutation = useRef(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const result = await api().from("session_activity_logs").select("log_id,details,created_at")
        .eq("action", "INVENTORY_DISCREPANCY").order("log_id", { ascending: false }).limit(10);
      if (!active) return;
      if (result.error) setAlertError(errorMessage(result.error));
      else { setAlerts(result.data as Alert[]); setAlertError(""); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const run = async (action: () => Promise<void>) => {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (cause) { setError(errorMessage(cause)); }
    finally { mutation.current = false; setBusy(false); }
  };
  const reader = card?.users;
  const eligible = reader?.is_active && reader.user_role === "Reader" && reader.membership_status === "ACTIVE"
    && !!reader.membership_expires_at && new Date(reader.membership_expires_at).getTime() > Date.now();
  const button = "rounded-xl bg-[#a83d12] px-4 py-3 text-sm font-bold text-white disabled:opacity-50";

  return <section aria-label="Reader check-in" className="mb-6 space-y-4 rounded-2xl border border-[#e8dfd3] bg-[#fffdf9] p-5 shadow-sm sm:p-6">
    <div><h2 className="font-serif text-2xl font-semibold">Reader check-in</h2>
      <p className="mt-2 text-sm text-[#795a42]">Scan the reader's library card, verify their identity, then approve entry. Their kiosk screen will update automatically.</p></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void run(async () => {
      setCard(null); setVerified(false); setDiagnosis("");
      const result = await api().from("librarycard")
        .select("is_active,deactivated_at,users(first_name,last_name,username,birthdate,is_active,user_role,membership_status,membership_expires_at)")
        .eq("librarycard_rfid", rfid.trim()).maybeSingle();
      if (result.error) throw result.error;
      const found = result.data as unknown as ReaderCard | null;
      if (!found) { setDiagnosis("No matching card record. Check that the exact scanned value, including leading zeroes, was registered."); return; }
      if (!found.is_active || found.deactivated_at) { setDiagnosis("This library card is inactive. Activate or replace it before scanning again."); return; }
      const reader = found.users;
      if (!reader?.is_active || reader.user_role !== "Reader") { setDiagnosis("The linked reader account is inactive or is not a reader account."); return; }
      if (reader.membership_status !== "ACTIVE" || !reader.membership_expires_at || new Date(reader.membership_expires_at).getTime() <= Date.now()) {
        setDiagnosis("The linked membership is inactive or expired. Renew or activate it first."); return;
      }
      setCard(found);
      setDiagnosis("Card and membership are active. If kiosk login still says card not recognized, ask an administrator to check that this reader has a linked Supabase Auth login.");
    }); }}>
      <label className="min-w-60 flex-1 text-sm font-semibold">Library card RFID
        <input className="mt-2 block w-full rounded-xl border border-[#e2d5c8] bg-[#fffbf5] px-3 py-3 font-normal" required maxLength={100} autoComplete="off"
          value={rfid} disabled={busy} onChange={event => { setRfid(event.target.value); setCard(null); setVerified(false); setMessage(""); }} placeholder="Scan or enter the reader's card RFID" />
      </label>
      <button className={button} disabled={busy || !rfid.trim()}>Look up reader</button>
    </form>
    {diagnosis && <p role="status" className="rounded-xl border border-[#e2d5c8] bg-[#fffbf5] p-3 text-sm text-[#795a42]">{diagnosis}</p>}
    {reader && <div className="space-y-3 rounded-xl border border-[#e2d5c8] p-4">
      <p className="font-semibold">{reader.first_name} {reader.last_name} (@{reader.username})</p>
      <p className="text-sm">Birthdate: {reader.birthdate} · Membership: {reader.membership_status}</p>
      {!eligible && <p role="alert" className="text-sm text-red-800">Activate the reader account and an unexpired membership before check-in.</p>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={verified} disabled={busy || !eligible} onChange={event => setVerified(event.target.checked)} />I verified this reader's identity</label>
      <button className={button} disabled={busy || !verified || !eligible} onClick={() => void run(async () => {
        const result = await api().rpc("approve_kiosk_checkin", { p_rfid: rfid.trim() });
        if (result.error) throw result.error;
        setMessage(`Check-in approved for ${reader.first_name} ${reader.last_name}. They can now choose a seat and scan a book at the kiosk.`);
        setCard(null); setVerified(false); setRfid("");
      })}>{busy ? "Saving..." : "Approve check-in"}</button>
    </div>}
    <div className="space-y-2 border-t border-[#e8dfd3] pt-4"><h3 className="font-semibold">Recent inventory alerts</h3>
      {alertError ? <p role="alert" className="text-sm text-red-800">{alertError}</p>
        : alerts.length ? alerts.map(alert => <p key={alert.log_id} className="border-l-4 border-[#a83d12] pl-3 text-sm">{new Date(alert.created_at).toLocaleString()} — {alert.details}</p>)
          : <p className="text-sm text-[#795a42]">No inventory discrepancies reported.</p>}
    </div>
  </section>;
}
