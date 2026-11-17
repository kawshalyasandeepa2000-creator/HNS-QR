"use strict";
// Shared per-event contact pipeline statuses. All writes go to the admin-only
// Cloudflare Worker; never store CRM data in localStorage or client-only state.
(() => {
  const VALUES = ["Follow up started", "QTN Send", "Won", "Lost"];
  const TYPES = new Set(["qr", "reference", "scanned"]);
  let rows = new Map();
  let ready = false;
  let generation = 0;
  let lastError = "";
  const key = (type, id) => `${type}:${id}`;
  const notify = () => {
    document.querySelectorAll('[data-hns-status-message]').forEach(el => {
      el.textContent = ready ? "Status saves to Cloudflare D1 when changed." :
        (lastError ? `Status not ready: ${lastError}` : "Loading contact statuses…");
      el.classList.toggle('hns-status-error', !!lastError);
    });
    window.dispatchEvent(new Event('hns:contact-statuses-changed'));
  };
  const isReady = () => ready;
  const value = (type, id) => rows.get(key(type, String(id || ''))) || "";
  const matches = (type, id, filter) => !filter || filter === 'all' ||
    (filter === 'unset' ? !value(type, id) : value(type, id) === filter);
  function reset() {
    generation++;
    rows = new Map(); ready = false; lastError = "";
    notify();
  }
  async function load() {
    const myGeneration = ++generation;
    const campaign = selectedEventSlug;
    ready = false; lastError = "";
    notify();
    try {
      const next = new Map();
      let offset = 0;
      // Page through statuses so older contacts still retain their saved status.
      for (let page = 0; page < 100; page++) {
        const result = await api(`/api/admin/contact-statuses?event=${encodeURIComponent(campaign)}&offset=${offset}`);
        const data = await result.json();
        if (generation !== myGeneration || campaign !== selectedEventSlug) return;
        if (!Array.isArray(data.items)) throw new Error('Unexpected status API response.');
        for (const item of data.items) {
          if (TYPES.has(item.contactType) && item.contactId && VALUES.includes(item.status))
            next.set(key(item.contactType, item.contactId), item.status);
        }
        if (data.nextOffset === null || data.nextOffset === undefined) break;
        if (!Number.isSafeInteger(data.nextOffset) || data.nextOffset <= offset || page === 99)
          throw new Error('Status pagination limit reached.');
        offset = data.nextOffset;
      }
      rows = next; ready = true; lastError = "";
    } catch (err) {
      if (generation !== myGeneration) return;
      ready = false;
      lastError = err.message || 'Cloudflare Worker status endpoint unavailable. Deploy the updated Worker.';
    }
    notify();
  }
  function create(type, id, description = '') {
    const select = document.createElement('select');
    select.className = 'hns-row-status';
    select.setAttribute('aria-label', `Pipeline status for ${description || id}`);
    select.append(new Option('— Set status —', ''));
    for (const option of VALUES) select.append(new Option(option, option));
    const current = value(type, id);
    select.value = current;
    select.dataset.state = current ? current.toLowerCase().replace(/\s+/g,'-') : 'unset';
    select.disabled = !ready || !TYPES.has(type) || !id;
    if (!ready) select.title = lastError || 'Connecting to Cloudflare status storage';
    select.addEventListener('change', async () => {
      if (!ready || !adminToken || !TYPES.has(type)) return;
      const nextStatus = select.value;
      const previous = value(type, id);
      const campaign = selectedEventSlug;
      select.disabled = true;
      try {
        const response = await fetch(`${apiOrigin}/api/admin/contact-statuses?event=${encodeURIComponent(campaign)}`, {
          method: 'PATCH',
          headers: {Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json'},
          cache: 'no-store',
          body: JSON.stringify({contactType: type, contactId: String(id), status: nextStatus})
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Status save failed (HTTP ${response.status})`);
        }
        if (campaign !== selectedEventSlug) return;
        if (nextStatus) rows.set(key(type, id), nextStatus);
        else rows.delete(key(type, id));
        select.dataset.state = nextStatus ? nextStatus.toLowerCase().replace(/\s+/g, '-') : 'unset';
        window.dispatchEvent(new Event('hns:contact-statuses-changed'));
      } catch(err) {
        select.value = previous;
        select.dataset.state = previous ? previous.toLowerCase().replace(/\s+/g, '-') : 'unset';
        alert(`Could not save status to Cloudflare: ${err.message}. No status was changed.`);
      } finally {
        select.disabled = !ready;
      }
    });
    return select;
  }
  const getFilter = id => document.getElementById(id)?.value || 'all';
  const exportFilter = id => {
    const status = getFilter(id);
    return status === 'all' ? '' : `&status=${encodeURIComponent(status)}`;
  };
  window.HNSContactStatus = { VALUES, load, reset, create, value, matches, isReady, getFilter, exportFilter };
})();
