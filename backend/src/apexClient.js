import WebSocket from 'ws';
import { load } from 'cheerio';

// Status codes from the c2 (sta) column class name
const STATUS_LABELS = {
  in: 'Racing',
  si: 'Idle',
  ti: 'Timing',
  sr: 'Session Record',
  su: 'Lap Complete',
  sf: 'Finished',
  so: 'Pit Out',
};

const CELL_KEYS = {
  c1: 'grp',
  c2: 'sta',
  c3: 'rank',
  c4: 'kart',
  c5: 'driver',
  c6: 's1',
  c7: 's2',
  c8: 's3',
  c9: 'last_lap',
  c10: 'best_lap',
  c11: 'gap',
  c12: 'int',
  c13: 'laps',
};

// data-type attribute -> row field. Consistent across circuits & session types.
const CELL_TYPE_KEYS = {
  grp: 'grp',
  sta: 'sta',
  rk: 'rank',
  no: 'kart',
  dr: 'driver',
  s1: 's1',
  s2: 's2',
  s3: 's3',
  llp: 'last_lap',   // last lap
  blp: 'best_lap',   // best lap
  gap: 'gap',
  int: 'int',        // interval
  tlp: 'laps',       // total laps
  otr: 'on_track',   // time on track
  pit: 'pits',       // pit count
  lgt: 'lap_gap',    // laps to leader (sprint)
};

export class ApexClient {
  constructor({ config, onState, onLog = () => {} } = {}) {
    this.config = config;
    this.onState = onState;
    this.log = onLog;
    this.ws = null;
    this.reconnectTimer = null;
    this.connected = false;
    this.handshakeOk = false;
    this.buffer = '';
    this.backoffMs = 5000;
    this.autoReconnect = true;
    this.columnTypes = {}; // col index c<n> -> data-type, learned from grid header

    this.state = {
      connected: false,
      connectionState: 'idle',   // idle | connecting | connected | reconnecting | disconnected
      mode: null,               // 'r' race | 'p' practice | 'n' no live
      title1: '',
      title2: '',
      track: '',
      message: '',
      comments: [],
      timer: null,              // dyn1 count
      light: '',
      weather: { wth1: '', wth2: '', wth3: '' },
      drivers: [],              // array of driver rows (order = current grid order)
      driverMap: {},            // id -> driver row
      updatedAt: null,
    };

    this.resetDriverStore();
  }

  resetDriverStore() {
    this.state.drivers = [];
    this.state.driverMap = {};
  }

  // Safely close a socket that may still be mid-handshake: keep an error
  // listener attached until the socket has fully closed, so a terminate during
  // connection setup cannot raise an unhandled 'error' event and crash.
  closeSocket(ws) {
    if (!ws) return;
    ws.on('error', () => {});
    ws.once('close', () => ws.removeAllListeners());
    try { ws.terminate(); } catch (_) {}
  }

  connect() {
    const url = `wss://${this.config.apex.host}:${this.config.apex.wssPort}/`;
    this.log('info', `Connecting to ${url} ...`);
    this.state.connectionState = 'connecting';
    this.state.connected = false;

    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      this.closeSocket(old);
    }

    try {
      this.ws = new WebSocket(url, {
        headers: { Origin: this.config.apex.origin },
        handshakeTimeout: this.config.apex.connectTimeoutMs,
        perMessageDeflate: false,
      });
    } catch (e) {
      this.log('error', `Socket creation failed: ${e.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.connected = true;
      this.state.connected = true;
      this.state.connectionState = 'connected';
      this.backoffMs = 5000;
      this.log('info', 'WebSocket connected.');
    });

    this.ws.on('message', (data) => {
      this.handleData(data.toString());
      this.handshakeOk = true;
      if (this.onState) this.onState(this.state);
    });

    this.ws.on('error', (err) => {
      this.log('error', `WebSocket error: ${err.message}`);
    });

    this.ws.on('close', (code, reason) => {
      const wasConnected = this.connected;
      this.connected = false;
      this.state.connected = false;
      this.state.connectionState = this.autoReconnect ? 'reconnecting' : 'disconnected';
      this.log('warn', `WebSocket closed (code=${code}). Reconnecting in ${this.backoffMs / 1000}s...`);
      if (this.onState) this.onState(this.state);
      this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimer || !this.autoReconnect) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.5, 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.connected && this.autoReconnect) this.connect();
    }, delay);
  }

  disconnect() {
    this.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.state.connected = false;
    this.state.connectionState = 'disconnected';
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      // Keep an error listener until the socket fully closes so terminating a
      // mid-handshake connection can't raise an unhandled 'error' event.
      this.closeSocket(ws);
    }
  }

  // Switch to a different circuit's host/port. Caller updates config.apex first.
  switchCircuit() {
    this.disconnect();
    this.buffer = '';
    this.autoReconnect = true;
    this.backoffMs = 5000;
    this.resetDriverStore();
    this.state.connected = false;
    this.state.mode = null;
    this.state.track = '';
    this.state.drivers = [];
    this.state.driverMap = {};
    this.connect();
    if (this.onState) this.onState(this.state);
  }

  handleData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length) this.handleLine(line);
    }
  }

  handleLine(line) {
    const parts = line.split('|');
    const key = parts[0];
    const type = parts[1] ?? '';
    const value = parts.slice(2).join('|');

    // Live status: init|p| or init|r| or init|n|
    if (key === 'init') {
      this.state.mode = type === 'r' ? 'race' : type === 'n' ? 'no_live' : 'practice';
      this.state.title1 = '';
      this.state.title2 = '';
      this.resetDriverStore();
      return;
    }

    if (key === 'gmt') return; // timezone hint, not needed

    // grid||<html> full replacement of the ranking table
    if (key === 'grid' && value) {
      this.parseGrid(value);
      return;
    }

    // css|...|... styling rules - ignore

    // Position updates: <driverId>|#|<pos> -> reorder
    if (type === '#') {
      const pos = parseInt(value, 10);
      this.applyPosition(key, pos);
      return;
    }

    // element updates by data-id: dyn1, wth1..3, track, title1/2, com, msg, light, best...
    if (key === 'dyn1') { this.state.timer = value; return; }
    if (key === 'track') { this.state.track = value; return; }
    if (key === 'title1') { this.state.title1 = value; return; }
    if (key === 'title2') { this.state.title2 = value; return; }
    if (key === 'msg') { this.state.message = value; return; }
    if (key === 'light') { this.state.light = type; return; }
    if (key === 'wth1') { this.state.weather.wth1 = value; return; }
    if (key === 'wth2') { this.state.weather.wth2 = value; return; }
    if (key === 'wth3') { this.state.weather.wth3 = value; return; }
    if (key === 'com') { this.parseComments(value); return; }

    // per-cell driver updates: <driverId>c<col>|class|<value>
    const cellMatch = /^([a-z0-9]+)c(\d+)$/i.exec(key);
    if (cellMatch) {
      const did = cellMatch[1];
      const col = 'c' + cellMatch[2];
      const colType = this.columnTypes[col];
      const field = colType ? CELL_TYPE_KEYS[colType] : CELL_KEYS[col];
      const row = this.state.driverMap[did];
      if (row && field) {
        // Track sector changes for degradation detection
        if (colType === 's1' || colType === 's2' || colType === 's3') {
          const prevField = 'prev' + field.toUpperCase();
          row[prevField] = row[field];
          row[field] = value;
        } else {
          row[field] = value;
        }
        // status column updates: the class name IS the status indicator
        if (colType === 'sta') {
          const newStatus = type || row.status;
          if (newStatus !== row.status) {
            // Live "in pit" indicator: 'si' = stationary/in pit
            row.inPit = newStatus === 'si' || newStatus === 'so';
            row.status = newStatus;
            row.statusLabel = STATUS_LABELS[newStatus] || newStatus || 'Unknown';
            row.statusChangedAt = Date.now();
          }
        }
      }
    }
  }

  applyPosition(driverId, pos) {
    const row = this.state.driverMap[driverId];
    if (!row) return;
    const prev = row.position;
    row.prevPosition = prev;
    row.posChange = prev > 0 ? prev - pos : 0; // positive = moved up, negative = dropped
    row.position = pos;
    this.state.drivers.sort((a, b) => (a.position || 0) - (b.position || 0));
  }

  parseGrid(html) {
    const $ = load(`<table>${html}</table>`);
    const rows = [];

    // Learn column layout from the header row (handles different session types/circuits)
    this.columnTypes = {};
    $('tr.head td, tr[data-id="r0"] td, thead td, thead th').each((_, td) => {
      const $td = $(td);
      const type = $td.attr('data-type');
      const cid = $td.attr('data-id') || $td.attr('id');
      const m = (cid || '').match(/c(\d+)$/);
      if (type && m) this.columnTypes[`c${m[1]}`] = type;
    });

    $('tr').each((_, tr) => {
      const $tr = $(tr);
      const id = $tr.attr('data-id');
      if (!id) return;
      if ($tr.hasClass('head')) return;
      const position = parseInt($tr.attr('data-pos') || '0', 10);
      const row = {
        id,
        position,
        prevPosition: 0,
        posChange: 0,
        grp: '',
        sta: '',
        rank: '',
        kart: '',
        driver: '',
        status: '',
        statusLabel: '',
        s1: '',
        s2: '',
        s3: '',
        prevS1: '',
        prevS2: '',
        prevS3: '',
        last_lap: '',
        best_lap: '',
        gap: '',
        int: '',
        laps: '',
        on_track: '',
        pits: '',
        lap_gap: '',
        pitHistory: [],
        inPit: false,
        pitEntryTime: null,
        pitExitTime: null,
        pitDuration: null,
      };
      $(tr).find('td').each((_, td) => {
        const $td = $(td);
        const type = $td.attr('data-type');
        const text = $td.text().trim();

        // 1. td carries its own data-type (header or some rows)
        if (type && CELL_TYPE_KEYS[type]) {
          const field = CELL_TYPE_KEYS[type];
          row[field] = text;
          if (type === 'sta') row.status = $td.attr('class') || '';
          return;
        }

        // 2. Resolve column position -> type learned from header (data rows have no data-type)
        const cid = $td.attr('data-id');
        const colMatch = cid ? /c(\d+)$/.exec(cid) : null;
        if (colMatch) {
          const colKey = `c${colMatch[1]}`;
          const colType = this.columnTypes[colKey];
          const field = colType ? CELL_TYPE_KEYS[colType] : CELL_KEYS[colKey];
          if (field) {
            row[field] = text;
            if (colType === 'sta') row.status = $td.attr('class') || '';
            return;
          }
        }

        // 3. data-id may live on an inner element, e.g. <div data-id="r25c4">76</div>
        const $cell = $(td).find(`[data-id^="${id}c"]`).first();
        const innerId = $cell.attr('data-id');
        if (innerId) {
          const colKey = `c${innerId.replace(/^.*c(\d+)$/, '$1')}`;
          const colType = this.columnTypes[colKey];
          const cellField = colType ? CELL_TYPE_KEYS[colType] : CELL_KEYS[colKey];
          if (cellField) {
            row[cellField] = $cell.text().trim();
            if (colType === 'sta') row.status = $cell.attr('class') || '';
          }
        }
      });
      row.statusLabel = STATUS_LABELS[row.status] || row.status || 'Unknown';
      rows.push(row);
    });
    this.state.drivers = rows;
    this.state.driverMap = {};
    for (const r of rows) this.state.driverMap[r.id] = r;
    this.state.drivers.sort((a, b) => (a.position || 0) - (b.position || 0));
    this.state.updatedAt = Date.now();
  }

  parseComments(html) {
    if (!html) return;
    const $ = load(`<div>${html}</div>`);
    const items = [];
    $('p').each((_, p) => {
      const $p = $(p);
      const time = $p.find('b').first().text() || '';
      const text = $p.clone().find('b').remove().end().text().trim();
      const flags = [];
      $p.find('[data-flag]').each((_, f) => flags.push($(f).attr('data-flag')));
      // kart numbers involved: <span class="com_no no8">11</span> — the class is a
      // colour group, the TEXT is the actual dorsal
      const karts = [];
      $p.find('.com_no').each((_, n) => {
        const txt = $(n).text().trim();
        if (txt) karts.push(txt);
      });
      items.push({ time, text, flags, karts });
    });
    this.state.comments = items;
  }

  findDriverByKart(kartNumber) {
    const k = String(kartNumber);
    return this.state.drivers.find((d) => String(d.kart) === k) || null;
  }

  findDriverById(driverId) {
    return this.state.driverMap[driverId] || null;
  }

  getState() {
    return this.state;
  }
}
