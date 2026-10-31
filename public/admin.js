const campaignName = document.querySelector('#campaign-name');
const totalCount = document.querySelector('#total-count');
const referralRows = document.querySelector('#referral-rows');
const adminError = document.querySelector('#admin-error');
const qrUrl = document.querySelector('#qr-url');
async function refresh() {
  adminError.textContent = '';
  try {
    const response = await fetch('/api/admin/stats', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load admin data. Check your login.');
    const data = await response.json();
    campaignName.textContent = data.campaign;
    totalCount.textContent = data.total.toLocaleString();
    qrUrl.textContent = data.qrTarget;
    referralRows.replaceChildren();
    if (!data.recent.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'No referral codes yet. Scan the QR to create the first one.';
      tr.append(td);
      referralRows.append(tr);
    } else {
      for (const row of data.recent) {
        const tr = document.createElement('tr');
        for (const value of [row.code, row.createdAt]) {
          const td = document.createElement('td');
          td.textContent = value;
          tr.append(td);
        }
        referralRows.append(tr);
      }
    }
  } catch (error) { adminError.textContent = error.message; }
}
document.querySelector('#refresh-button').addEventListener('click', refresh);
document.querySelector('#print-button').addEventListener('click', () => window.print());
refresh();
