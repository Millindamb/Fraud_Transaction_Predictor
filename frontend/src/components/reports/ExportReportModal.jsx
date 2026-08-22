import { useState } from 'react';
import { Download } from 'lucide-react';
import { listTransactions } from '../../api/transactions';
import { Modal, Field, Input, Select, Button } from '../ui/Primitives';
import { compactInr } from '../../lib/format';

const BAND_OPTIONS = [
  { value: '', label: 'All Bands' },
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

const CSV_HEADERS = [
  'Transaction ID', 'Date', 'Time', 'Amount (INR)', 'Merchant', 'Category',
  'City', 'Rule Score', 'ML Score', 'Final Score', 'Band', 'Decision', 'Flags',
];

const MAX_PAGES = 40; // guard rail: 40 x 100 = 4,000 rows per export
const todayStr = () => new Date().toISOString().slice(0, 10);

function escapeCsvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toRow(tx) {
  const d = new Date(tx.timestamp);
  return [
    tx.transactionId,
    d.toLocaleDateString('en-IN'),
    d.toLocaleTimeString('en-IN', { hour12: false }),
    tx.amount,
    tx.merchant?.name || '',
    tx.merchant?.category || '',
    tx.location?.city || '',
    tx.ruleScore,
    tx.mlScore,
    tx.finalScore,
    tx.band,
    tx.decision,
    (tx.flags || []).map((f) => f.code ?? f).join('; '),
  ];
}

function buildConclusion({ total, blocked, blockedValue, alertRate }) {
  if (!total) return 'No transactions in this period.';
  if (blocked === 0)
    return `No confirmed fraud blocked across ${total} transactions — traffic looked clean.`;
  if (alertRate > 0.15)
    return `Elevated-risk window: ${blocked} of ${total} transactions were blocked, keeping ${compactInr(blockedValue)} from reaching a real cardholder.`;
  return `${blocked} fraud attempt${blocked === 1 ? '' : 's'} blocked out of ${total} transactions, protecting ${compactInr(blockedValue)}.`;
}

function buildSummaryLines(rows, from, to) {
  const total = rows.length;
  const blocked = rows.filter((t) => t.decision === 'BLOCK');
  const alerts = rows.filter((t) => ['ALERT', 'BLOCK'].includes(t.decision));
  const blockedValue = blocked.reduce((s, t) => s + (t.amount || 0), 0);
  const avgScore = total ? Math.round(rows.reduce((s, t) => s + (t.finalScore || 0), 0) / total) : 0;
  const bandCount = (b) => rows.filter((t) => t.band === b).length;
  const period = from && to ? `${from} to ${to}` : from ? `${from} onward` : to ? `Up to ${to}` : 'All time';

  return [
    ['Report Summary', ''],
    ['Period', period],
    ['Generated on', new Date().toLocaleString('en-IN')],
    ['', ''],
    ['Total transactions', total],
    ['Alerts raised', alerts.length],
    ['Fraud blocked', blocked.length],
    ['Value protected', compactInr(blockedValue)],
    ['Average risk score', avgScore],
    ['', ''],
    ['Low', bandCount('LOW')],
    ['Medium', bandCount('MEDIUM')],
    ['High', bandCount('HIGH')],
    ['Critical', bandCount('CRITICAL')],
    ['', ''],
    ['Conclusion', buildConclusion({
      total,
      blocked: blocked.length,
      blockedValue,
      alertRate: total ? alerts.length / total : 0,
    })],
  ];
}

export default function ExportReportModal({ onClose }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [band, setBand] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const download = async () => {
    setError(null);

    const today = todayStr();
    if ((from && from > today) || (to && to > today)) {
      setError('Future dates are not selectable — the report only covers transactions that have happened.');
      return;
    }

    setBusy(true);
    try {
      const filter = {};
      if (from) filter.from = new Date(from).toISOString();
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        filter.to = end.toISOString();
      }
      if (band) filter.band = band;

      const rows = [];
      let page = 1;
      let pages = 1;
      do {
        const res = await listTransactions({ ...filter, page, limit: 100 });
        rows.push(...(res.items || []));
        pages = res.pages || 1;
        page += 1;
      } while (page <= pages && page <= MAX_PAGES);

      if (!rows.length) {
        setError('No transactions match that range.');
        return;
      }

      const dataRows = rows.map(toRow);
      const summaryLines = buildSummaryLines(rows, from, to);
      const height = Math.max(dataRows.length, summaryLines.length);

      const header = [...CSV_HEADERS, '', 'Summary', ''];
      const body = Array.from({ length: height }, (_, i) => [
        ...(dataRows[i] || Array(CSV_HEADERS.length).fill('')),
        '',
        ...(summaryLines[i] || ['', '']),
      ]);

      const csv = [header, ...body]
        .map((r) => r.map(escapeCsvCell).join(','))
        .join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fraudguard-transactions-${from || 'all'}_to_${to || 'all'}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not generate the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Download Report" icon={<Download size={16} />} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Date">
            <Input
              type="date"
              value={from}
              max={to || todayStr()}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="End Date">
            <Input
              type="date"
              value={to}
              min={from || undefined}
              max={todayStr()}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Risk Band" hint="Filter to a single decision band, or export everything.">
          <Select value={band} onChange={(e) => setBand(e.target.value)}>
            {BAND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>

        {error && <p className="text-xs text-band-critical">{error}</p>}

        {!from && !to && !error && (
          <p className="text-[11px] leading-relaxed text-slate1">
            No dates selected — this exports every transaction in the ledger (up to {MAX_PAGES * 100} rows).
          </p>
        )}
      </div>

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={download} busy={busy}>
          <Download size={14} />
          Download Report
        </Button>
      </div>
    </Modal>
  );
}