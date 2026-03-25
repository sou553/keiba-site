(function (global) {
  const AC = global.AC || {};

  AC.toNum = function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  AC.round1 = function round1(v) {
    return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
  };

  AC.roundPct01 = function roundPct01(v) {
    const n = AC.toNum(v);
    return n === null ? '-' : `${AC.round1(n * 100)}%`;
  };

  AC.escapeHtml = function escapeHtml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  AC.pick = function pick(obj, keys, fallback = null) {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return fallback;
  };

  AC.formatOdds = function formatOdds(v) {
    const n = AC.toNum(v);
    return n === null ? '—' : String(AC.round1(n));
  };

  AC.readQuery = function readQuery() {
    const p = new URLSearchParams(global.location.search);
    return {
      date: p.get('date') || '',
      race_id: p.get('race_id') || ''
    };
  };

  AC.resolveDataRoot = function resolveDataRoot() {
    return document.body?.dataset?.dataRoot || './data';
  };

  AC.fetchJson = async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}: ${path}`);
    }
    return res.json();
  };

  global.AC = AC;
})(window);
