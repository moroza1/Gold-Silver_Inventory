import { useEffect, useMemo, useState, type CSSProperties } from 'react';

// ============================================================================
// GL Configuration screen (self-contained). Backs the maker-checker admin API
// under /api/gl-config. Panels: Chart of Accounts, Posting Rules, a live
// Simulator (dry-run the posting engine), and Versions & Approvals which hosts a
// FORM-BASED rule builder (add/remove rules & legs with account dropdowns, live
// per-rule balance). Auth is handled by App's global fetch wrapper.
// ============================================================================

type Props = { apiBase: string; canModify: boolean; lang?: string };

type VersionDto = {
  versionId: number; versionNumber: number; status: string; changeSummary?: string | null;
  createdBy: string; createdAt: string; submittedBy?: string | null; submittedAt?: string | null;
  reviewedBy?: string | null; reviewedAt?: string | null; reviewComments?: string | null;
  activatedAt?: string | null; configJson?: string | null;
};
type SimLine = { accountCode: string; accountName: string; side: string; amount: number; memo?: string | null };
type SimResult = { ok: boolean; lines: SimLine[]; totalDebits: number; totalCredits: number; balanced: boolean; error?: string | null };

// Editable form model (round-trips to/from the config JSON)
type EditLeg = { account: string; side: string; amountFactor: number; memo: string };
type EditRule = { eventType: string; commodity: string; matchOwnership: string; otherMatch: Record<string, string>; description: string; legs: EditLeg[] };
type EditAccount = { code: string; name: string; type: string; currency: string };

const EVENT_TYPES = ['Purchase', 'Sale', 'Transfer', 'Adjustment', 'WriteOff'];
const ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];
const OWNERSHIPS = ['', 'KFH_OWNED', 'CUSTOMER_OWNED'];
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#00934C', DRAFT: '#6B7280', PENDING_CHECKER: '#D97706', REJECTED: '#DC2626', ARCHIVED: '#9CA3AF',
};

export default function GlConfigScreen({ apiBase, canModify, lang = 'en' }: Props) {
  const [tab, setTab] = useState<'accounts' | 'rules' | 'simulate' | 'versions'>('accounts');
  const [active, setActive] = useState<VersionDto | null>(null);
  const [versions, setVersions] = useState<VersionDto[]>([]);
  const [draft, setDraft] = useState<VersionDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Form-builder state (populated when a draft is opened)
  const [baseCurrency, setBaseCurrency] = useState('KWD');
  const [editAccounts, setEditAccounts] = useState<EditAccount[]>([]);
  const [editRules, setEditRules] = useState<EditRule[]>([]);
  const [changeSummary, setChangeSummary] = useState('');
  const [showJson, setShowJson] = useState(false);

  // Simulator
  const [sim, setSim] = useState({ eventType: 'Purchase', commodity: 'GOLD', amount: 20000, ownership: '' });
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [simAgainstDraft, setSimAgainstDraft] = useState(false);

  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);

  async function api(path: string, init?: RequestInit) {
    const res = await fetch(`${apiBase}${path}`, {
      ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }, cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
    return body;
  }

  async function loadAll() {
    try {
      const [a, vs] = await Promise.all([
        fetch(`${apiBase}/gl-config/active`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)),
        api('/gl-config/versions'),
      ]);
      setActive(a); setVersions(vs);
      setDraft((vs as VersionDto[]).find(v => v.status === 'DRAFT') || null);
    } catch (e: any) { setMsg({ kind: 'err', text: e.message }); }
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, []);

  // Parse a draft's config JSON into the editable form model (once per draft).
  useEffect(() => {
    if (!draft?.configJson) return;
    try {
      const c = JSON.parse(draft.configJson);
      setBaseCurrency(c.baseCurrency || 'KWD');
      setEditAccounts((c.accounts || []).map((a: any) => ({ code: a.code, name: a.name, type: a.type, currency: a.currency || '' })));
      setEditRules((c.rules || []).map((r: any) => {
        const match = r.match || {};
        const { ownership, ...otherMatch } = match;
        return {
          eventType: r.eventType, commodity: r.commodity || '*', matchOwnership: ownership || '',
          otherMatch, description: r.description || '',
          legs: (r.legs || []).map((l: any) => ({ account: l.account, side: l.side, amountFactor: l.amountFactor ?? 1, memo: l.memo || '' })),
        };
      }));
      setChangeSummary(draft.changeSummary || '');
    } catch { /* leave form as-is if the draft JSON is unreadable */ }
  }, [draft?.versionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // View panels read the ACTIVE config (read-only).
  const activeConfig = useMemo(() => {
    try { return active?.configJson ? JSON.parse(active.configJson) : null; } catch { return null; }
  }, [active]);
  const viewAccounts: any[] = activeConfig?.accounts ?? [];
  const viewRules: any[] = activeConfig?.rules ?? [];
  const viewRulesByEvent = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const r of viewRules) (g[r.eventType] ??= []).push(r);
    return g;
  }, [viewRules]);

  // Serialize the form back into a GlConfiguration-shaped object.
  function buildConfig() {
    return {
      baseCurrency,
      accounts: editAccounts.map(a => ({ code: a.code, name: a.name, type: a.type, ...(a.currency ? { currency: a.currency } : {}) })),
      rules: editRules.map(r => {
        const match: Record<string, string> = { ...r.otherMatch, ...(r.matchOwnership ? { ownership: r.matchOwnership } : {}) };
        const rule: any = {
          eventType: r.eventType, commodity: r.commodity || '*',
          legs: r.legs.map(l => ({ account: l.account, side: l.side, ...(Number(l.amountFactor) !== 1 ? { amountFactor: Number(l.amountFactor) } : {}), ...(l.memo ? { memo: l.memo } : {}) })),
        };
        if (Object.keys(match).length) rule.match = match;
        if (r.description) rule.description = r.description;
        return rule;
      }),
    };
  }
  const configJsonPreview = useMemo(() => JSON.stringify(buildConfig(), null, 2), [baseCurrency, editAccounts, editRules]);

  // ----- immutable form mutators -----
  const patchRule = (i: number, patch: Partial<EditRule>) => setEditRules(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const patchLeg = (ri: number, li: number, patch: Partial<EditLeg>) =>
    setEditRules(rs => rs.map((r, k) => (k === ri ? { ...r, legs: r.legs.map((l, m) => (m === li ? { ...l, ...patch } : l)) } : r)));
  const addLeg = (ri: number) => setEditRules(rs => rs.map((r, k) => (k === ri ? { ...r, legs: [...r.legs, { account: editAccounts[0]?.code || '', side: 'Debit', amountFactor: 1, memo: '' }] } : r)));
  const removeLeg = (ri: number, li: number) => setEditRules(rs => rs.map((r, k) => (k === ri ? { ...r, legs: r.legs.filter((_, m) => m !== li) } : r)));
  const addRule = () => setEditRules(rs => [...rs, { eventType: 'Purchase', commodity: '*', matchOwnership: '', otherMatch: {}, description: '', legs: [{ account: editAccounts[0]?.code || '', side: 'Debit', amountFactor: 1, memo: '' }, { account: editAccounts[0]?.code || '', side: 'Credit', amountFactor: 1, memo: '' }] }]);
  const removeRule = (i: number) => setEditRules(rs => rs.filter((_, k) => k !== i));
  const patchAccount = (i: number, patch: Partial<EditAccount>) => setEditAccounts(as => as.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  const addAccount = () => setEditAccounts(as => [...as, { code: '', name: '', type: 'Asset', currency: '' }]);
  const removeAccount = (i: number) => setEditAccounts(as => as.filter((_, k) => k !== i));

  const legFactor = (legs: EditLeg[], side: string) => legs.filter(l => l.side === side).reduce((s, l) => s + (Number(l.amountFactor) || 0), 0);

  // ----- workflow actions -----
  async function openOrCreateDraft() {
    setBusy(true); setMsg(null);
    try { const d: VersionDto = await api('/gl-config/draft', { method: 'POST' }); setDraft(d); setTab('versions'); await loadAll(); }
    catch (e: any) { setMsg({ kind: 'err', text: e.message }); } finally { setBusy(false); }
  }
  async function saveDraft() {
    if (!draft) return;
    setBusy(true); setMsg(null);
    try {
      await api(`/gl-config/draft/${draft.versionId}`, { method: 'PUT', body: JSON.stringify({ configJson: JSON.stringify(buildConfig()), changeSummary }) });
      setMsg({ kind: 'ok', text: T('Draft saved and validated.', 'تم حفظ المسودة والتحقق منها.') });
      await loadAll();
    } catch (e: any) { setMsg({ kind: 'err', text: e.message }); } finally { setBusy(false); }
  }
  async function submitDraft() {
    if (!draft) return;
    setBusy(true); setMsg(null);
    try {
      // Save the current form first so what gets submitted is what's on screen.
      await api(`/gl-config/draft/${draft.versionId}`, { method: 'PUT', body: JSON.stringify({ configJson: JSON.stringify(buildConfig()), changeSummary }) });
      await api(`/gl-config/draft/${draft.versionId}/submit`, { method: 'POST' });
      setMsg({ kind: 'ok', text: T('Submitted for approval. A different user must approve it.', 'تم الإرسال للاعتماد. يجب أن يعتمده مستخدم آخر.') });
      setDraft(null); await loadAll();
    } catch (e: any) { setMsg({ kind: 'err', text: e.message }); } finally { setBusy(false); }
  }
  async function approve(v: VersionDto) {
    setBusy(true); setMsg(null);
    try { await api(`/gl-config/versions/${v.versionId}/approve`, { method: 'POST' }); setMsg({ kind: 'ok', text: T(`Version ${v.versionNumber} approved and is now ACTIVE.`, `تم اعتماد الإصدار ${v.versionNumber}.`) }); await loadAll(); }
    catch (e: any) { setMsg({ kind: 'err', text: e.message }); } finally { setBusy(false); }
  }
  async function reject(v: VersionDto) {
    const comments = window.prompt(T('Reason for rejection:', 'سبب الرفض:')) || '';
    setBusy(true); setMsg(null);
    try { await api(`/gl-config/versions/${v.versionId}/reject`, { method: 'POST', body: JSON.stringify({ comments }) }); setMsg({ kind: 'ok', text: T(`Version ${v.versionNumber} rejected.`, `تم رفض الإصدار ${v.versionNumber}.`) }); await loadAll(); }
    catch (e: any) { setMsg({ kind: 'err', text: e.message }); } finally { setBusy(false); }
  }
  async function runSimulate() {
    setBusy(true); setMsg(null); setSimResult(null);
    try {
      const r: SimResult = await api('/gl-config/simulate', {
        method: 'POST',
        body: JSON.stringify({
          eventType: sim.eventType, commodity: sim.commodity, amount: Number(sim.amount),
          ownership: sim.ownership || null,
          configJson: simAgainstDraft && draft ? JSON.stringify(buildConfig()) : null,
        }),
      });
      setSimResult(r);
    } catch (e: any) { setMsg({ kind: 'err', text: e.message }); } finally { setBusy(false); }
  }

  const badge = (status: string) => (
    <span style={{ background: STATUS_COLORS[status] || '#6b7280', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{status}</span>
  );
  const pending = versions.filter(v => v.status === 'PENDING_CHECKER');
  const accountOptions = (current: string) => {
    const codes = editAccounts.map(a => a.code);
    const opts = editAccounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>);
    if (current && !codes.includes(current)) opts.unshift(<option key={current} value={current}>{current} (?)</option>);
    return opts;
  };
  const inp: CSSProperties = { padding: '4px 6px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4 };

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>{T('General Ledger Configuration', 'إعدادات دفتر الأستاذ العام')}</h2>
        {active && <span style={{ fontSize: 13, color: '#555' }}>{T('Active', 'الفعّال')}: v{active.versionNumber} {badge('ACTIVE')}</span>}
        {pending.length > 0 && <span style={{ fontSize: 13, color: '#d97706' }}>· {pending.length} {T('awaiting approval', 'بانتظار الاعتماد')}</span>}
      </div>

      {msg && (
        <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', marginBottom: 12, fontSize: 13,
          background: msg.kind === 'ok' ? 'var(--kfh-green-light)' : '#fef2f2', color: msg.kind === 'ok' ? 'var(--kfh-green)' : '#dc2626',
          border: `1px solid ${msg.kind === 'ok' ? 'var(--kfh-green)' : '#fca5a5'}` }}>{msg.text}</div>
      )}

      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--surface-border)', marginBottom: 14 }}>
        {([['accounts', T('Chart of Accounts', 'دليل الحسابات')], ['rules', T('Posting Rules', 'قواعد الترحيل')],
           ['simulate', T('Simulator', 'المحاكاة')], ['versions', T('Versions & Approvals', 'الإصدارات والاعتمادات')]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k as any)} style={{
            padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
            fontWeight: tab === k ? 700 : 400, borderBottom: tab === k ? '2px solid var(--kfh-green)' : '2px solid transparent',
            color: tab === k ? 'var(--kfh-green)' : '#374151' }}>{lbl}</button>
        ))}
      </div>

      {/* CHART OF ACCOUNTS (read-only view of ACTIVE) */}
      {tab === 'accounts' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ padding: 8 }}>{T('Code', 'الرمز')}</th><th style={{ padding: 8 }}>{T('Name', 'الاسم')}</th>
            <th style={{ padding: 8 }}>{T('Type', 'النوع')}</th><th style={{ padding: 8 }}>{T('Currency', 'العملة')}</th>
          </tr></thead>
          <tbody>
            {viewAccounts.map((a: any) => (
              <tr key={a.code} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: 8, fontFamily: 'monospace' }}>{a.code}</td><td style={{ padding: 8 }}>{a.name}</td>
                <td style={{ padding: 8 }}>{a.type}</td><td style={{ padding: 8 }}>{a.currency || activeConfig?.baseCurrency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* POSTING RULES (read-only view of ACTIVE) */}
      {tab === 'rules' && (
        <div>
          {Object.entries(viewRulesByEvent).map(([evt, rs]) => (
            <div key={evt} style={{ marginBottom: 18 }}>
              <h4 style={{ margin: '0 0 6px' }}>{evt}</h4>
              {rs.map((r: any, i: number) => (
                <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>
                    {T('Commodity', 'المعدن')}: <b>{r.commodity || '*'}</b>
                    {r.match && Object.keys(r.match).length > 0 && (<> · {T('when', 'عند')} {Object.entries(r.match).map(([k, v]) => `${k}=${v}`).join(', ')}</>)}
                    {r.description && <> · <i>{r.description}</i></>}
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {r.legs?.map((l: any, j: number) => (
                      <span key={j} style={{ fontSize: 13, fontFamily: 'monospace', color: l.side === 'Debit' ? '#1d4ed8' : '#b45309' }}>
                        {l.side === 'Debit' ? 'Dr' : 'Cr'} {l.account}
                        {viewAccounts.find((a: any) => a.code === l.account) ? ` (${viewAccounts.find((a: any) => a.code === l.account).name})` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* SIMULATOR */}
      {tab === 'simulate' && (
        <div style={{ maxWidth: 680 }}>
          <p style={{ fontSize: 13, color: '#555' }}>
            {T('Preview the exact journal entry an inventory event would produce — nothing is posted.',
               'استعرض القيد المحاسبي الذي سيُنشأ لحركة مخزون — دون ترحيل فعلي.')}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
            <label style={{ fontSize: 12 }}>{T('Event', 'الحركة')}<br />
              <select value={sim.eventType} onChange={e => setSim({ ...sim, eventType: e.target.value })} style={inp}>
                {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select></label>
            <label style={{ fontSize: 12 }}>{T('Commodity', 'المعدن')}<br />
              <input value={sim.commodity} onChange={e => setSim({ ...sim, commodity: e.target.value.toUpperCase() })} style={{ ...inp, width: 90 }} /></label>
            <label style={{ fontSize: 12 }}>{T('Amount', 'المبلغ')}<br />
              <input type="number" value={sim.amount} onChange={e => setSim({ ...sim, amount: Number(e.target.value) })} style={{ ...inp, width: 110 }} /></label>
            <label style={{ fontSize: 12 }}>{T('Ownership', 'الملكية')}<br />
              <select value={sim.ownership} onChange={e => setSim({ ...sim, ownership: e.target.value })} style={inp}>
                {OWNERSHIPS.map(o => <option key={o} value={o}>{o || '(none)'}</option>)}
              </select></label>
            <button className="btn" onClick={runSimulate} disabled={busy}>{T('Simulate', 'محاكاة')}</button>
          </div>
          {draft && (
            <label style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              <input type="checkbox" checked={simAgainstDraft} onChange={e => setSimAgainstDraft(e.target.checked)} />{' '}
              {T('Simulate against the open DRAFT (unsaved edits included)', 'المحاكاة على المسودة (بما في ذلك التعديلات غير المحفوظة)')}
            </label>
          )}
          {simResult && (simResult.ok ? (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ textAlign: 'left', color: '#666' }}>
                  <th style={{ padding: 4 }}>{T('Account', 'الحساب')}</th>
                  <th style={{ padding: 4, textAlign: 'right' }}>Debit</th><th style={{ padding: 4, textAlign: 'right' }}>Credit</th>
                </tr></thead>
                <tbody>
                  {simResult.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ padding: 4 }}>{l.accountCode} {l.accountName}</td>
                      <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace' }}>{l.side === 'Debit' ? l.amount.toFixed(2) : ''}</td>
                      <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace' }}>{l.side === 'Credit' ? l.amount.toFixed(2) : ''}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid #e5e7eb', fontWeight: 700 }}>
                    <td style={{ padding: 4 }}>{T('Total', 'الإجمالي')}</td>
                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace' }}>{simResult.totalDebits.toFixed(2)}</td>
                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace' }}>{simResult.totalCredits.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ marginTop: 8, fontSize: 13, color: simResult.balanced ? '#16a34a' : '#dc2626' }}>
                {simResult.balanced ? T('✓ Balanced (double-entry holds)', '✓ متوازن') : T('✗ Not balanced', '✗ غير متوازن')}
              </div>
            </div>
          ) : (<div style={{ color: '#b91c1c', fontSize: 13 }}>{T('No entry produced:', 'لم يُنشأ قيد:')} {simResult.error}</div>))}
        </div>
      )}

      {/* VERSIONS & APPROVALS + FORM BUILDER */}
      {tab === 'versions' && (
        <div>
          {canModify && (
            !draft
              ? <button className="btn" onClick={openOrCreateDraft} disabled={busy} style={{ marginBottom: 14 }}>{T('Create / edit draft', 'إنشاء / تعديل مسودة')}</button>
              : (
                <div style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: 14, marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <b>{T('Editing draft', 'تعديل المسودة')} v{draft.versionNumber}</b> {badge('DRAFT')}
                    <input placeholder={T('Change summary (what & why)', 'ملخص التغيير')} value={changeSummary}
                      onChange={e => setChangeSummary(e.target.value)} style={{ ...inp, flex: 1, minWidth: 220 }} />
                    <label style={{ fontSize: 12 }}>{T('Base currency', 'العملة الأساسية')}{' '}
                      <input value={baseCurrency} onChange={e => setBaseCurrency(e.target.value.toUpperCase())} style={{ ...inp, width: 70 }} /></label>
                  </div>

                  {/* Accounts editor */}
                  <h4 style={{ margin: '10px 0 6px' }}>{T('Chart of Accounts', 'دليل الحسابات')}</h4>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 8 }}>
                    <thead><tr style={{ textAlign: 'left', color: '#666' }}>
                      <th style={{ padding: 4 }}>{T('Code', 'الرمز')}</th><th style={{ padding: 4 }}>{T('Name', 'الاسم')}</th>
                      <th style={{ padding: 4 }}>{T('Type', 'النوع')}</th><th style={{ padding: 4 }}>{T('Currency', 'العملة')}</th><th></th>
                    </tr></thead>
                    <tbody>
                      {editAccounts.map((a, i) => (
                        <tr key={i}>
                          <td style={{ padding: 3 }}><input value={a.code} onChange={e => patchAccount(i, { code: e.target.value })} style={{ ...inp, width: 70, fontFamily: 'monospace' }} /></td>
                          <td style={{ padding: 3 }}><input value={a.name} onChange={e => patchAccount(i, { name: e.target.value })} style={{ ...inp, width: '100%' }} /></td>
                          <td style={{ padding: 3 }}><select value={a.type} onChange={e => patchAccount(i, { type: e.target.value })} style={inp}>{ACCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}</select></td>
                          <td style={{ padding: 3 }}><input value={a.currency} placeholder={baseCurrency} onChange={e => patchAccount(i, { currency: e.target.value.toUpperCase() })} style={{ ...inp, width: 60 }} /></td>
                          <td style={{ padding: 3 }}><button className="btn" onClick={() => removeAccount(i)} title="remove" style={{ padding: '2px 8px' }}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button className="btn" onClick={addAccount} style={{ padding: '3px 10px', fontSize: 12, marginBottom: 14 }}>+ {T('Add account', 'إضافة حساب')}</button>

                  {/* Rules editor */}
                  <h4 style={{ margin: '10px 0 6px' }}>{T('Posting Rules', 'قواعد الترحيل')}</h4>
                  {editRules.map((r, ri) => {
                    const df = legFactor(r.legs, 'Debit'), cf = legFactor(r.legs, 'Credit');
                    const balanced = df === cf && df > 0;
                    return (
                      <div key={ri} style={{ border: `1px solid ${balanced ? '#e5e7eb' : '#fca5a5'}`, borderRadius: 8, padding: 10, marginBottom: 10 }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                          <select value={r.eventType} onChange={e => patchRule(ri, { eventType: e.target.value })} style={inp}>{EVENT_TYPES.map(t => <option key={t}>{t}</option>)}</select>
                          <label style={{ fontSize: 12 }}>{T('commodity', 'المعدن')} <input value={r.commodity} onChange={e => patchRule(ri, { commodity: e.target.value.toUpperCase() })} placeholder="* / GOLD" style={{ ...inp, width: 90 }} /></label>
                          <label style={{ fontSize: 12 }}>{T('when ownership', 'عند الملكية')} <select value={r.matchOwnership} onChange={e => patchRule(ri, { matchOwnership: e.target.value })} style={inp}>{OWNERSHIPS.map(o => <option key={o} value={o}>{o || '(any)'}</option>)}</select></label>
                          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: balanced ? '#16a34a' : '#dc2626' }}>
                            {balanced ? `✓ ${T('balanced', 'متوازن')}` : `✗ Dr ${df} / Cr ${cf}`}
                          </span>
                          <button className="btn" onClick={() => removeRule(ri)} style={{ padding: '2px 8px' }}>✕ {T('rule', 'قاعدة')}</button>
                        </div>
                        <input value={r.description} onChange={e => patchRule(ri, { description: e.target.value })} placeholder={T('description (optional)', 'وصف (اختياري)')} style={{ ...inp, width: '100%', marginBottom: 8 }} />
                        {r.legs.map((l, li) => (
                          <div key={li} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
                            <select value={l.side} onChange={e => patchLeg(ri, li, { side: e.target.value })} style={{ ...inp, color: l.side === 'Debit' ? '#1d4ed8' : '#b45309', fontWeight: 600 }}>
                              <option value="Debit">Dr</option><option value="Credit">Cr</option>
                            </select>
                            <select value={l.account} onChange={e => patchLeg(ri, li, { account: e.target.value })} style={{ ...inp, minWidth: 240 }}>{accountOptions(l.account)}</select>
                            <label style={{ fontSize: 11, color: '#888' }}>×<input type="number" step="0.01" value={l.amountFactor} onChange={e => patchLeg(ri, li, { amountFactor: Number(e.target.value) })} style={{ ...inp, width: 64 }} /></label>
                            <input value={l.memo} onChange={e => patchLeg(ri, li, { memo: e.target.value })} placeholder={T('memo', 'ملاحظة')} style={{ ...inp, flex: 1 }} />
                            <button className="btn" onClick={() => removeLeg(ri, li)} style={{ padding: '2px 8px' }}>✕</button>
                          </div>
                        ))}
                        <button className="btn" onClick={() => addLeg(ri)} style={{ padding: '2px 10px', fontSize: 12, marginTop: 4 }}>+ {T('Add leg', 'إضافة طرف')}</button>
                      </div>
                    );
                  })}
                  <button className="btn" onClick={addRule} style={{ padding: '3px 10px', fontSize: 12 }}>+ {T('Add rule', 'إضافة قاعدة')}</button>

                  <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                    <button className="btn" onClick={saveDraft} disabled={busy}>{T('Save & validate', 'حفظ وتحقق')}</button>
                    <button className="btn" onClick={submitDraft} disabled={busy}>{T('Submit for approval', 'إرسال للاعتماد')}</button>
                    <button className="btn" onClick={() => setShowJson(s => !s)} style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }}>{showJson ? T('Hide JSON', 'إخفاء JSON') : T('Preview JSON', 'معاينة JSON')}</button>
                  </div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                    {T('Save validates double-entry & account existence server-side. A different user must approve (segregation of duties).',
                       'الحفظ يتحقق من القيد المزدوج ووجود الحسابات على الخادم. يجب أن يعتمده مستخدم آخر (فصل المهام).')}
                  </div>
                  {showJson && <pre style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, fontSize: 11, overflow: 'auto', maxHeight: 260, marginTop: 8 }}>{configJsonPreview}</pre>}
                </div>
              )
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>v#</th><th style={{ padding: 8 }}>{T('Status', 'الحالة')}</th>
              <th style={{ padding: 8 }}>{T('Summary', 'الملخص')}</th><th style={{ padding: 8 }}>{T('Maker', 'المُعِد')}</th>
              <th style={{ padding: 8 }}>{T('Checker', 'المعتمد')}</th><th style={{ padding: 8 }}></th>
            </tr></thead>
            <tbody>
              {versions.map(v => (
                <tr key={v.versionId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: 8 }}>{v.versionNumber}</td>
                  <td style={{ padding: 8 }}>{badge(v.status)}</td>
                  <td style={{ padding: 8 }}>{v.changeSummary || '—'}{v.reviewComments ? ` · ✗ ${v.reviewComments}` : ''}</td>
                  <td style={{ padding: 8 }}>{v.submittedBy || v.createdBy}</td>
                  <td style={{ padding: 8 }}>{v.reviewedBy || '—'}</td>
                  <td style={{ padding: 8 }}>
                    {canModify && v.status === 'PENDING_CHECKER' && (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button className="btn" onClick={() => approve(v)} disabled={busy}>{T('Approve', 'اعتماد')}</button>
                        <button className="btn" onClick={() => reject(v)} disabled={busy}>{T('Reject', 'رفض')}</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
            {T('Approving is blocked for the maker/submitter of a change (segregation of duties).',
               'لا يمكن للمُعِد اعتماد تغييره (فصل المهام).')}
          </div>
        </div>
      )}
    </div>
  );
}
