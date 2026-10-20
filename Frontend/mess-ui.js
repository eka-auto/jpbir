/* ============================================================================
   MESSENGER UI (WhatsApp + Telegram)
   ----------------------------------------------------------------------------
   One client, two sources. Everything is driven by SRC:
     wa -> /api/jp-whatsapp   /api/jp-wa-messages   /api/jp-wa-chat
     tg -> /api/jp-telegram  /api/jp-tg-messages   /api/jp-tg-chat

   The Telegram endpoints do not exist yet (there is no tg_* table and no
   Telegram data anywhere on the box), so Telegram renders an explicit
   "not captured yet" state rather than an empty list that reads like
   "no messages found". That distinction is the whole point of this panel.

   Honesty rules baked in:
     * The headline is "N chats with readable text", never a bare row count.
     * Metadata-only chats are a separate, labelled bucket.
     * Every number comes from the API payload; none is typed in here.
     * Encrypted rows are drawn as visibly locked, not as fake text.
   ========================================================================= */
(function () {
  'use strict';

  /* Each source points at one inventory endpoint. The message endpoint is
     appended with an op= parameter because Telegram is served by a single
     route (jp-telegram.js) while WhatsApp has dedicated routes. */
  var SOURCES = {
    wa: {
      label: 'WhatsApp',
      icon: '\u{1F4AC}',
      inventory: '/api/jp-whatsapp',
      messages: '/api/jp-wa-messages',
      chat: '/api/jp-wa-chat',
      app: 'WhatsApp',
      emptyHint: 'No WhatsApp data captured yet.'
    },
    tg: {
      label: 'Telegram',
      icon: '\u2708',
      inventory: '/api/jp-telegram',
      messages: '/api/jp-telegram?op=messages',
      chat: '/api/jp-telegram?op=chat',
      app: 'Telegram',
      emptyHint: 'No Telegram data captured yet.'
    }
  };

  function $(id) { return document.getElementById(id); }
  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return (n || 0).toLocaleString('en-IN'); }

  function key() {
    try {
      var k = sessionStorage.getItem('jbt_stats_key') || localStorage.getItem('jbt_stats_key') || '';
      if (k) return k;
    } catch (e) { /* private mode */ }
    /* The dashboard accepts ?key= on first load and strips it from the URL
       before any request goes out. Mirror that so this module works even if
       it runs before the main script's stripper. */
    try { return new URLSearchParams(location.search).get('key') || ''; }
    catch (e) { return ''; }
  }
  function clearKey() {
    try { sessionStorage.removeItem('jbt_stats_key'); localStorage.removeItem('jbt_stats_key'); } catch (e) {}
  }
  /* The gate lives inside the dashboard's own IIFE, so it is not reachable
     from here. Ask for it over an event instead of reaching into another
     script's scope. */
  function askGate(msg) {
    try {
      window.dispatchEvent(new CustomEvent('mess:unauthorized', { detail: { message: msg } }));
    } catch (e) {
      /* No listener yet: the dashboard is the only host, so this is fine. */
    }
  }

  /* ---------- shared state, one per source ---------- */
  var ST = {};
  function state(src) {
    if (!ST[src]) {
      ST[src] = {
        src: src,
        chats: [],
        totals: {},
        runs: [],
        filter: '',
        tab: 'readable',      // readable | all | meta
        selected: null,
        loaded: false,
        msg: { chatId: null, q: '', before: null, shown: 0, total: 0, loading: false, reqId: 0 }
      };
    }
    return ST[src];
  }

  /* ---------- helpers ---------- */
  function initials(name) {
    var s = String(name || '?').trim();
    if (!s) return '?';
    if (/^\d+$/.test(s)) return '#' + s.slice(-2);
    var parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  function isNumericName(n) { return /^\d+$/.test(String(n || '').trim()); }

  function dayLabel(iso) {
    if (!iso) return 'Undated';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'Undated';
    return d.toISOString().slice(0, 10);
  }
  function timeLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(11, 16);
  }
  function lastSeenLabel(c) {
    if (c.last_at) return c.last_at;
    if (c.lastAt) return c.lastAt;
    return '';
  }

  /* ---------- inventory rendering ---------- */
  function chatIsReadable(c) { return (c.readable_count || 0) > 0; }

  function visibleChats(s) {
    var q = s.filter.trim().toLowerCase();
    return s.chats.filter(function (c) {
      if (s.tab === 'readable' && !chatIsReadable(c)) return false;
      if (s.tab === 'meta' && chatIsReadable(c)) return false;
      if (!q) return true;
      return String(c.name || '').toLowerCase().indexOf(q) >= 0
        || String(c.chat_id || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderSplit(s) {
    var host = $(s.src + 'Split');
    if (!host) return;
    var t = s.totals || {};
    var readableChats = s.chats.filter(chatIsReadable).length;
    var metaChats = s.chats.length - readableChats;
    var msgTotal = (t.readable || 0) + (t.enc || 0);
    var readablePct = msgTotal ? Math.round(((t.readable || 0) / msgTotal) * 100) : 0;
    host.innerHTML =
      '<div class="mess-split-cell readable">'
      + '<div class="n">' + fmt(readableChats) + '</div>'
      + '<div class="l">chats with readable text<br>' + fmt(t.readable || 0) + ' messages &middot; ' + readablePct + '%</div>'
      + '</div>'
      + '<div class="mess-split-cell meta">'
      + '<div class="n">' + fmt(metaChats) + '</div>'
      + '<div class="l">chats, metadata only<br>' + fmt(t.enc || 0) + ' locked rows</div>'
      + '</div>';
  }

  /* The supporting totals, below the headline rather than in place of it.
     These are the numbers the old panel showed: how many groups, how much
     media, and how big the gap is between what the device reported and
     what actually made it into the store. Every value comes from the API's
     totals object. */
  function renderTotals(s) {
    var host = $(s.src + 'Totals');
    if (!host) return;
    var t = s.totals || {};
    if (!s.chats.length) { host.innerHTML = ''; return; }
    var kv = function (k, v, title) {
      return '<div class="kv-item"' + (title ? ' title="' + esc(title) + '"' : '') + '>'
        + '<div class="k">' + esc(k) + '</div><div class="v">' + fmt(v) + '</div></div>';
    };
    host.innerHTML =
      kv('Chats', t.chats) +
      kv('Groups', t.groups) +
      kv('Direct', t.direct) +
      kv('Stored rows', t.stored) +
      kv('Inventory gap', t.missing, 'Messages the device reported that never reached the store') +
      kv('Media', t.media) +
      kv('Audio', t.audio) +
      kv('Calls', t.calls) +
      kv('Undated', t.undated);
  }


  function renderTabs(s) {
    var host = $(s.src + 'Tabs');
    if (!host) return;
    var readableChats = s.chats.filter(chatIsReadable).length;
    var tabs = [
      { id: 'readable', label: 'Readable (' + fmt(readableChats) + ')' },
      { id: 'all', label: 'All chats (' + fmt(s.chats.length) + ')' },
      { id: 'meta', label: 'Metadata only (' + fmt(s.chats.length - readableChats) + ')' }
    ];
    host.innerHTML = tabs.map(function (t) {
      return '<button type="button" class="mess-tab" data-tab="' + t.id + '" aria-pressed="'
        + (s.tab === t.id ? 'true' : 'false') + '">' + esc(t.label) + '</button>';
    }).join('');
  }

  function renderChatList(s) {
    var host = $(s.src + 'ChatList');
    if (!host) return;
    var rows = visibleChats(s);
    var count = $(s.src + 'ChatCount');
    if (count) {
      count.textContent = fmt(rows.length) + (rows.length === 1 ? ' chat' : ' chats');
    }
    if (!rows.length) {
      host.innerHTML = '<div class="state" style="padding:28px 16px">'
        + (s.chats.length
          ? 'No chats match this filter.'
          : (SOURCES[s.src].emptyHint + ' Nothing has been ingested for this source yet.'))
        + '</div>';
      return;
    }
    host.innerHTML = rows.map(function (c) {
      var name = c.name || c.chat_id;
      var group = c.kind === 'group';
      var r = c.readable_count || 0;
      var e = c.enc_count || 0;
      var m = c.media_count || 0;
      var sub = r > 0
        ? fmt(r) + ' readable message' + (r === 1 ? '' : 's')
        : 'No readable text \u00b7 ' + fmt(e) + ' locked row' + (e === 1 ? '' : 's');
      var badges = '';
      if (r > 0) badges += '<span class="mess-badge r">' + fmt(r) + ' readable</span>';
      if (e > 0) badges += '<span class="mess-badge e">' + fmt(e) + ' locked</span>';
      if (m > 0) badges += '<span class="mess-badge m">' + fmt(m) + ' media</span>';
      if (c.call_count > 0) badges += '<span class="mess-badge">' + fmt(c.call_count) + ' calls</span>';
      if (c.member_count > 0) badges += '<span class="mess-badge">' + fmt(c.member_count) + ' members</span>';
      return '<button type="button" class="mess-chat" data-chat-id="' + esc(c.chat_id) + '"'
        + ' aria-selected="' + (s.selected === c.chat_id ? 'true' : 'false') + '">'
        + '<div class="mess-av' + (group ? ' group' : '') + '">' + esc(initials(name)) + '</div>'
        + '<div class="mess-chat-main">'
        + '<div class="mess-chat-top"><span class="mess-chat-name">' + esc(name) + '</span>'
        + '<span class="mess-chat-time">' + esc(lastSeenLabel(c)) + '</span></div>'
        + '<div class="mess-chat-sub">' + esc(sub) + '</div>'
        + '<div class="mess-badges">' + badges + '</div>'
        + '</div><div></div></button>';
    }).join('');
  }

  function renderThread(s) {
    var head = $(s.src + 'Thread');
    if (!head) return;
    if (!s.selected) {
      head.innerHTML = '<div class="mess-empty"><div class="big">' + SOURCES[s.src].icon + '</div>'
        + '<div><b>Select a chat</b><br>Pick a conversation on the left to read its stored messages.</div></div>';
      return;
    }
    var c = s.chats.filter(function (x) { return x.chat_id === s.selected; })[0] || {};
    var name = c.name || s.selected;
    var sub = [];
    if (c.first_at || c.last_at) sub.push((c.first_at || '?') + ' \u2192 ' + (c.last_at || '?'));
    if (c.member_count) sub.push(c.member_count + ' members');
    if (c.kind) sub.push(c.kind);
    head.innerHTML = '<div class="mess-av' + (c.kind === 'group' ? ' group' : '') + '">' + esc(initials(name)) + '</div>'
      + '<div style="min-width:0;flex:1">'
      + '<div class="mess-thread-title">' + esc(name) + '</div>'
      + '<div class="mess-thread-sub">' + esc(sub.join(' \u00b7 ') || s.selected) + '</div>'
      + '</div>';
  }

  /* ---------- message rendering ---------- */
  /* A chat with 104 readable messages and 19,733 locked rows must not open
     on 200 locked bubbles with the text buried underneath. The thread
     therefore has two modes:
       readable -> only the messages whose body is real text
       all      -> every stored row, locked ones drawn as locked
     A chat with no readable text opens in "all", because that is all there
     is, and the note explains why the bubbles are locked. */
  function threadMode(s) {
    var c = s.chats.filter(function (x) { return x.chat_id === s.selected; })[0];
    if (!c) return 'all';
    return chatIsReadable(c) ? 'readable' : 'all';
  }

  /* The API pages newest-first, and undated rows sort ahead of dated ones
     (NULLS LAST on a DESC sort). A chat thread has to read oldest-to-newest
     with undated messages parked at the end, so the order is rebuilt here
     rather than trusted from the query. */
  function sortThread(rows) {
    var dated = [], undated = [];
    rows.forEach(function (m) {
      if (m.sent_at) dated.push(m); else undated.push(m);
    });
    dated.sort(function (a, b) {
      var d = String(a.sent_at).localeCompare(String(b.sent_at));
      if (d !== 0) return d;
      return String(a.msg_id || '').localeCompare(String(b.msg_id || ''));
    });
    return dated.concat(undated);
  }

  function bubble(s, m) {
    var mine = m.from_me === true;
    var readable = m.readable === true;
    var when = timeLabel(m.sent_at);
    var label = m.sender_label || m.sender || 'Unknown sender';
    var body = m.display_body || m.body || '';
    var meta = '<div class="mess-bubble-meta">'
      + (when ? esc(when) : 'undated')
      + (mine && readable ? ' <span class="mess-tick">\u2713\u2713</span>' : '')
      + '</div>';
    if (!readable) {
      return '<div class="mess-row ' + (mine ? 'out' : 'in') + '">'
        + '<div class="mess-bubble locked">'
        + '<div class="mess-sender" style="color:var(--wa-text-2)">' + esc(label) + '</div>'
        + '<div style="font-size:12px">\u{1F512} Encrypted \u2014 ' + esc(m.kind || 'message') + ' stored, body not decryptable</div>'
        + meta + '</div></div>';
    }
    return '<div class="mess-row ' + (mine ? 'out' : 'in') + '">'
      + '<div class="mess-bubble">'
      + (mine ? '' : '<div class="mess-sender">' + esc(label) + '</div>')
      + esc(body)
      + meta
      + '</div></div>';
  }

  function renderMessages(s, keepScroll) {
    /* The bubbles live inside the scrolling body, so that is the only
       element involved: the markup has no separate message container. */
    var body = $(s.src + 'Body');
    if (!body) return;
    var host = body;
    var prevTop = body.scrollTop;
    var prevHeight = body.scrollHeight;
    var batch = s.msg.batch || [];
    if (!batch.length) {
      host.innerHTML = '<div class="state" style="padding:28px 16px">'
        + (s.msg.loading ? 'Loading\u2026'
          : (s.msg.total ? 'No rows on this page.' : 'No message rows stored for this chat.'))
        + '</div>';
      return;
    }
    var html = '';
    var lastDay = '';
    batch.forEach(function (m) {
      var d = dayLabel(m.sent_at);
      if (d !== lastDay) { html += '<div class="mess-day">' + esc(d) + '</div>'; lastDay = d; }
      html += bubble(s, m);
    });
    host.innerHTML = html;
    if (!body) return;
    if (keepScroll) {
      /* Older messages were prepended, so the same content must stay under
         the reader's eyes: shift the scroll by the height that appeared
         above, instead of jumping. */
      body.scrollTop = prevTop + (body.scrollHeight - prevHeight);
    } else {
      body.scrollTop = body.scrollHeight;
    }
  }

  /* ---------- notes under the thread ---------- */
  /* The mode switch, shown only when a chat has both kinds of row. */
  function renderMode(s) {
    var btn = $(s.src + 'Mode');
    if (!btn) return;
    var c = s.chats.filter(function (x) { return x.chat_id === s.selected; })[0];
    if (!c || !(c.readable_count > 0) || !(c.enc_count > 0)) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    var readable = s.msg.mode !== 'all';
    btn.setAttribute('aria-pressed', readable ? 'true' : 'false');
    btn.textContent = readable ? 'Show all rows' : 'Show readable text';
  }

  function renderNotes(s) {
    var host = $(s.src + 'Notes');
    if (!host) return;
    if (!s.selected) { host.innerHTML = ''; return; }
    var c = s.chats.filter(function (x) { return x.chat_id === s.selected; })[0] || {};
    var notes = '';
    if (!(c.readable_count > 0)) {
      notes += '<div class="mess-note"><b>No readable text for this chat.</b> '
        + 'These rows came from a sealed recovery dump. ' + SOURCES[s.src].app
        + ' bodies are end-to-end encrypted, so the text was never present here and cannot be rebuilt cloud-side. '
        + 'Export the chat from the phone (without media) and import it, mapping the file to this exact id or every line is dropped on ingest:</div>'
        + '<div class="mess-note" style="border:none;background:none;padding:4px 12px 0">'
        + '<code>' + esc(s.selected) + '</code></div>';
    }
    /* The ingest's own drop notes are surfaced, not swallowed: a broken
       chat-export mapping otherwise hides behind a lower message count. */
    var dropped = (s.runs || []).filter(function (r) {
      return r.note && /dropped/i.test(r.note);
    });
    if (dropped.length) {
      notes += '<div class="mess-note" style="border-color:rgba(240,185,104,.45)">'
        + '<b>Ingest gap:</b> ' + dropped.length + ' import run(s) reported dropped messages. '
        + esc(dropped[0].note) + '</div>';
    }
    host.innerHTML = notes;
  }

  /* ---------- data loading ---------- */
  function setStatus(s, text) {
    var el = $(s.src + 'Status');
    if (el) el.textContent = text || '';
  }

  function loadInventory(src, force) {
    var s = state(src);
    if (s.loaded && !force) return Promise.resolve();
    var cfg = SOURCES[src];
    setStatus(s, 'loading\u2026');
    return fetch(cfg.inventory, { cache: 'no-cache', headers: { 'x-stats-key': key() } })
      .then(function (r) {
        return r.json().then(function (b) { return { status: r.status, body: b }; });
      })
      .then(function (res) {
        if (res.status === 401) {
          clearKey();
          setStatus(s, '');
          askGate('Invalid key.');
          return;
        }
        var j = res.body || {};
        if (!j.ok) {
          setStatus(s, 'Error: ' + (j.error || 'unknown'));
          return;
        }
        s.loaded = true;
        if (j.migrated === false) {
          s.chats = []; s.totals = {}; s.runs = [];
          setStatus(s, j.note || 'Source tables are not migrated yet.');
          renderAll(s);
          return;
        }
        s.chats = j.chats || [];
        s.totals = j.totals || {};
        s.runs = j.runs || [];
        setStatus(s, 'live \u00b7 ' + (j.generated_at ? 'as of ' + String(j.generated_at).slice(0, 16).replace('T', ' ') + ' UTC' : 'just now'));
        renderAll(s);
      })
      .catch(function (e) {
        setStatus(s, 'load failed');
        console.error('[' + src + '] inventory load failed', e);
      });
  }

  function renderAll(s) {
    renderSplit(s);
    renderTotals(s);
    renderTabs(s);
    renderChatList(s);
    renderThread(s);
    renderMode(s);
    renderNotes(s);
    if (s.selected) { renderMessages(s); }
  }

  function loadMessages(src, chatId, append, mode) {
    var s = state(src);
    var cfg = SOURCES[src];
    if (!chatId) return;
    if (append && (s.msg.loading || !s.msg.before || s.msg.chatId !== chatId)) return;
    if (!append) {
      s.msg.chatId = chatId; s.msg.q = ''; s.msg.before = null;
      s.msg.shown = 0; s.msg.total = 0; s.msg.batch = [];
      /* A newly opened chat starts in the mode that shows its content:
         readable text if it has any, every row if it does not. An explicit
         mode (the switch) overrides that. */
      s.msg.mode = mode || threadMode(s);
    }
    var token = ++s.msg.reqId;
    s.msg.loading = true;
    renderMessages(s);
    var params = { chat_id: chatId, limit: 200, readable_first: 0 };
    if (s.msg.q) params.q = s.msg.q;
    if (append && s.msg.before) params.before = s.msg.before;
    /* "readable" asks the API for real text only; "all" takes every stored
       row, locked ones included. The API's readable filter is what keeps a
       chat with tens of thousands of locked rows from opening on a wall of
       locked bubbles. */
    if (s.msg.mode === 'readable') params.readable = 1;
    /* The Telegram message route already carries op=messages, so join with
       & rather than blindly appending another ?. */
    var sep = cfg.messages.indexOf('?') >= 0 ? '&' : '?';
    fetch(cfg.messages + sep + new URLSearchParams(params).toString(),
      { cache: 'no-store', headers: { 'x-stats-key': key() } })
      .then(function (r) {
        return r.json().then(function (b) { return { status: r.status, body: b }; });
      })
      .then(function (res) {
        if (s.msg.reqId !== token || s.msg.chatId !== chatId) return;
        s.msg.loading = false;
        if (res.status === 401) { clearKey(); askGate('Invalid key.'); return; }
        var j = res.body || {};
        if (!j.ok) { s.msg.batch = []; renderMessages(s); setStatus(s, 'message load failed'); return; }
        var batch = j.messages || [];
        s.msg.shown += batch.length;
        s.msg.total = j.total_count == null ? s.msg.shown : (j.total_count | 0);
        s.msg.before = j.next_before || null;
        /* Older pages are prepended: a thread grows upwards, and the newest
           message stays at the bottom where a chat client puts it. */
        s.msg.batch = sortThread(append ? batch.concat(s.msg.batch || []) : batch);
        renderMessages(s, append);
        renderNotes(s);
        var more = $(src + 'More');
        if (more) {
          more.disabled = false;
          more.textContent = append ? 'Loading older\u2026' : 'Load older messages';
          more.style.display = s.msg.before ? '' : 'none';
        }
        var hint = $(src + 'MsgHint');
        if (hint) {
          var readableMode = s.msg.mode !== 'all';
          hint.textContent = (readableMode
            ? 'Showing ' + fmt(s.msg.shown) + ' readable message' + (s.msg.shown === 1 ? '' : 's')
            : 'Showing ' + fmt(s.msg.shown) + ' of ' + fmt(s.msg.total) + ' stored rows')
            + ' \u00b7 ' + fmt(j.total_readable_count || 0) + ' readable'
            + ' \u00b7 ' + fmt(j.total_metadata_count || 0) + ' locked'
            + (readableMode && (j.total_metadata_count || 0) ? ' \u00b7 locked rows hidden' : '');
        }
        renderMode(s);
      })
      .catch(function (e) {
        if (s.msg.reqId !== token) return;
        s.msg.loading = false;
        s.msg.batch = [];
        renderMessages(s);
        console.error('[' + src + '] message load failed', e);
      });
  }

  /* ---------- events ---------- */
  function wire(src) {
    var s = state(src);

    var search = $(src + 'Search');
    if (search) search.addEventListener('input', function () {
      s.filter = search.value;
      renderChatList(s);
      var list = $(src + 'ChatList');
      if (list) list.scrollTop = 0;
    });

    var tabs = $(src + 'Tabs');
    if (tabs) tabs.addEventListener('click', function (e) {
      var b = e.target.closest('.mess-tab');
      if (!b) return;
      s.tab = b.getAttribute('data-tab');
      renderTabs(s);
      renderChatList(s);
    });

    var list = $(src + 'ChatList');
    if (list) list.addEventListener('click', function (e) {
      var b = e.target.closest('.mess-chat');
      if (!b) return;
      s.selected = b.getAttribute('data-chat-id');
      renderChatList(s);
      renderThread(s);
      renderNotes(s);
      loadMessages(src, s.selected, false);
    });

    var more = $(src + 'More');
    if (more) more.addEventListener('click', function () {
      loadMessages(src, s.msg.chatId, true);
    });

    var mode = $(src + 'Mode');
    if (mode) mode.addEventListener('click', function () {
      if (!s.msg.chatId) return;
      var next = s.msg.mode === 'all' ? 'readable' : 'all';
      /* Reload from the top: the cursor belongs to the other mode's ordering,
         so it cannot be carried over. The chosen mode is passed in so the
         reload does not fall back to the default. */
      loadMessages(src, s.msg.chatId, false, next);
    });

    var refresh = $(src + 'Refresh');
    if (refresh) refresh.addEventListener('click', function () {
      loadInventory(src, true);
    });
  }

  /* ---------- public API ---------- */
  var API = {
    SOURCES: SOURCES,
    load: function (src, force) { return loadInventory(src, force); },
    select: function (src, chatId) {
      var s = state(src);
      s.selected = chatId;
      renderChatList(s); renderThread(s); renderNotes(s);
      loadMessages(src, chatId, false);
    },
    wire: wire,
    state: state
  };
  window.MessUI = API;

  function boot() {
    Object.keys(SOURCES).forEach(wire);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
