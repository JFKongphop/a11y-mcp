import type { ParseReport } from '../content/bridge';

// Phase 6 — the confidence badge. A badly-marked-up site is not a failure; it is
// the tool reporting truthfully. That honesty is what makes the universal claim
// defensible: we never fill low-confidence fields silently, and we say so here.

const badge = document.getElementById('badge') as HTMLDivElement;
const status = document.getElementById('status') as HTMLParagraphElement;

function chip(cls: string, label: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = `chip ${cls}`;
  el.textContent = label;
  return el;
}

function render(report: ParseReport | null) {
  if (!report) {
    status.textContent = 'a11y-mcp is not active on this tab (needs an HTTPS page with the WebMCP flag).';
    return;
  }
  if (!report.hasForm || report.total === 0) {
    status.textContent = 'No form detected on this page.';
    return;
  }

  badge.replaceChildren(
    chip('mapped', `${report.mapped} mapped`),
    chip('ambiguous', `${report.ambiguous} ambiguous`),
    chip('unlabeled', `${report.unlabeled} unlabeled`)
  );
  badge.hidden = false;

  const risky = report.ambiguous + report.unlabeled;
  status.textContent = risky
    ? `${report.unlabeled} field(s) will not be filled without your confirmation.`
    : `All ${report.total} fields mapped with high confidence.`;
}

async function load() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return render(null);
    const report = await chrome.tabs.sendMessage(tab.id, { type: 'get-report' }).catch(() => null);
    render((report as ParseReport | null) ?? null);
  } catch {
    render(null);
  }
}

load();
