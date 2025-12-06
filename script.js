const form = document.getElementById('upload-form');
const statusEl = document.getElementById('status');
const resultsSection = document.getElementById('results');
const totalEl = document.getElementById('total-messages');
const sentEl = document.getElementById('sent-messages');
const receivedEl = document.getElementById('received-messages');
const reelsTotalEl = document.getElementById('reels-total');
const longestStreakEl = document.getElementById('longest-streak');
const streakRangeEl = document.getElementById('streak-range');
const topThreadsEl = document.getElementById('top-threads');
const topStreaksEl = document.getElementById('top-streaks');
const topReelsEl = document.getElementById('top-reels');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const displayName = (formData.get('displayName') || '').trim();
  const files = formData.getAll('folder');

  if (!displayName) {
    statusEl.textContent = 'Please enter the display name used in your export.';
    return;
  }

  if (!files.length) {
    statusEl.textContent = 'Please select your inbox folder.';
    return;
  }

  setStatus('Parsing files... this stays offline.', true);
  form.querySelector('button').disabled = true;

  try {
    const results = await processInbox(files, displayName);
    renderResults(results);
    setStatus('Done! Scroll to see your recap.');
    resultsSection.hidden = false;
  } catch (error) {
    console.error(error);
    setStatus('Something went wrong while reading the export. Please double-check the folder and try again.');
  } finally {
    form.querySelector('button').disabled = false;
  }
});

function setStatus(message, loading = false) {
  statusEl.textContent = loading ? `⏳ ${message}` : message;
}

async function processInbox(files, displayName) {
  const threadMap = new Map();

  const messageFiles = files.filter((file) => /messages?\d*\.json$/i.test(file.name));
  if (!messageFiles.length) {
    throw new Error('No message JSON files found.');
  }

  for (const file of messageFiles) {
    const pathParts = file.webkitRelativePath.split(/\\|\//);
    const threadName = findThreadFolder(pathParts);
    if (!threadName) continue;

    const content = await file.text();
    let data;
    try {
      data = JSON.parse(content);
    } catch {
      continue;
    }

    const messages = Array.isArray(data.messages) ? data.messages : [];
    const entry = threadMap.get(threadName) || createBlankThread(threadName);
    for (const msg of messages) {
      entry.total += 1;
      const sender = msg.sender_name || '';
      const ts = msg.timestamp_ms;

      if (sender === displayName) {
        entry.sent += 1;
        if (ts) entry.sentDates.add(dateOnly(ts));
      } else if (sender) {
        entry.received += 1;
      }

      if (isReelMessage(msg)) {
        if (sender === displayName) {
          entry.reelsSent += 1;
        } else if (sender) {
          entry.reelsReceived += 1;
        }
      }
    }
    threadMap.set(threadName, entry);
  }

  const threads = Array.from(threadMap.values())
    .filter((thread) => thread.total > 0)
    .map((thread) => {
      const { length, start, end } = computeLongestStreak(Array.from(thread.sentDates));
      return {
        ...thread,
        streak: length,
        streakStart: start,
        streakEnd: end,
        reelsTotal: thread.reelsSent + thread.reelsReceived,
      };
    });

  threads.sort((a, b) => b.total - a.total);

  const overall = threads.reduce(
    (acc, t) => {
      acc.total += t.total;
      acc.sent += t.sent;
      acc.received += t.received;
      acc.reels += t.reelsTotal;
      if (t.streak > acc.longestStreak) {
        acc.longestStreak = t.streak;
        acc.streakRange = formatDateRange(t.streakStart, t.streakEnd);
      }
      return acc;
    },
    { total: 0, sent: 0, received: 0, reels: 0, longestStreak: 0, streakRange: 'N/A' }
  );

  return { threads, overall };
}

function findThreadFolder(parts) {
  const inboxIndex = parts.findIndex((segment) => segment.toLowerCase() === 'inbox');
  if (inboxIndex === -1 || inboxIndex === parts.length - 1) return null;
  return parts[inboxIndex + 1] || null;
}

function createBlankThread(name) {
  return {
    threadName: name,
    total: 0,
    sent: 0,
    received: 0,
    reelsSent: 0,
    reelsReceived: 0,
    sentDates: new Set(),
  };
}

function isReelMessage(msg) {
  if (msg.reel_share) return true;
  const share = msg.share || {};
  const link = (share.link || '').toString();
  const shareText = (share.share_text || '').toLowerCase();
  if (/instagram\.com\/.*(reel|reels)/i.test(link)) return true;
  return shareText.includes('reel');
}

function dateOnly(timestampMs) {
  const date = new Date(timestampMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function computeLongestStreak(sentDates) {
  if (!sentDates.length) return { length: 0, start: null, end: null };
  const sorted = [...new Set(sentDates)].sort((a, b) => a - b);
  let longest = 1;
  let current = 1;
  let longestStart = sorted[0];
  let longestEnd = sorted[0];
  let currentStart = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (sorted[i] === prev + 86400000) {
      current += 1;
    } else {
      current = 1;
      currentStart = sorted[i];
    }

    if (current > longest) {
      longest = current;
      longestStart = currentStart;
      longestEnd = sorted[i];
    }
  }

  if (longest === 1) {
    longestEnd = longestStart;
  }

  return { length: longest, start: longestStart, end: longestEnd };
}

function formatDateRange(startMs, endMs) {
  if (!startMs || !endMs) return 'N/A';
  const start = new Date(startMs).toISOString().slice(0, 10);
  const end = new Date(endMs).toISOString().slice(0, 10);
  return start === end ? start : `${start} → ${end}`;
}

function renderResults({ threads, overall }) {
  totalEl.textContent = overall.total.toLocaleString();
  sentEl.textContent = overall.sent.toLocaleString();
  receivedEl.textContent = overall.received.toLocaleString();
  reelsTotalEl.textContent = overall.reels.toLocaleString();
  longestStreakEl.textContent = `${overall.longestStreak} day${overall.longestStreak === 1 ? '' : 's'}`;
  streakRangeEl.textContent = overall.streakRange;

  topThreadsEl.innerHTML = renderRows(threads.slice(0, 10), (t) => `
    <div class="row">
      <div>
        <div class="row__title">${cleanName(t.threadName)}</div>
        <div class="row__meta">Total ${t.total.toLocaleString()} • Sent ${t.sent.toLocaleString()} • Received ${t.received.toLocaleString()}</div>
      </div>
      <div class="row__meta">Streak: ${t.streak} days</div>
      <div class="row__meta">Reels: ${t.reelsTotal}</div>
    </div>
  `);

  const streaks = threads.filter((t) => t.streak > 0).sort((a, b) => b.streak - a.streak);
  topStreaksEl.innerHTML = renderRows(streaks.slice(0, 10), (t) => `
    <div class="row">
      <div>
        <div class="row__title">${cleanName(t.threadName)}</div>
        <div class="row__meta">${formatDateRange(t.streakStart, t.streakEnd)}</div>
      </div>
      <div class="row__meta">Longest streak</div>
      <div class="row__meta">${t.streak} days</div>
    </div>
  `);

  const reels = threads.filter((t) => t.reelsTotal > 0).sort((a, b) => b.reelsTotal - a.reelsTotal);
  topReelsEl.innerHTML = renderRows(reels.slice(0, 10), (t) => `
    <div class="row">
      <div>
        <div class="row__title">${cleanName(t.threadName)}</div>
        <div class="row__meta">Reels sent ${t.reelsSent} • Reels received ${t.reelsReceived}</div>
      </div>
      <div class="row__meta">Total reels</div>
      <div class="row__meta">${t.reelsTotal}</div>
    </div>
  `);
}

function renderRows(items, renderer) {
  if (!items.length) return '<p class="row__meta">No data yet.</p>';
  return items.map(renderer).join('');
}

function cleanName(name) {
  return name.replace(/_\d+$/, '');
}