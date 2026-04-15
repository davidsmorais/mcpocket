import * as http from 'node:http';
import * as cp from 'node:child_process';
import type { ItemFilters } from './item-select.js';
import { sparkle, oops, c } from '../utils/sparkle.js';

const PORT = 3000;

export interface UiItems {
  agents: string[];
  skills: string[];
  mcps:   string[];
  plugins?: string[];
}

/**
 * Start a local HTTP server on port 3000, open the browser, and wait for
 * the user to submit their selection.  Resolves with ItemFilters once the
 * user clicks the sync button.
 */
export async function openSelectionUi(
  items: UiItems,
  action: 'push' | 'pull',
): Promise<ItemFilters> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildHtml(items, action));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/items') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...items, action }));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/sync') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const sel: { agents: string[]; skills: string[]; mcps: string[]; plugins?: string[] } = JSON.parse(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            server.close();
            resolve(buildFilters(sel, items));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        oops(`Port ${PORT} is already in use. Stop any other process using it and try again.`);
      } else {
        oops(err.message);
      }
      reject(err);
    });

    server.listen(PORT, '127.0.0.1', () => {
      const url = `http://localhost:${PORT}`;
      tryOpenBrowser(url);
      sparkle(`UI running at ${c.cyan(url)}`);
      sparkle('Select your items in the browser, then click the sync button…');
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFilters(
  sel: { agents: string[]; skills: string[]; mcps: string[]; plugins?: string[] },
  available: UiItems,
): ItemFilters {
  const filters: ItemFilters = {};
  if (sel.agents.length < available.agents.length) filters.agentNames = new Set(sel.agents);
  if (sel.skills.length < available.skills.length) filters.skillNames = new Set(sel.skills);
  if (sel.mcps.length   < available.mcps.length)   filters.mcpNames   = new Set(sel.mcps);
  if (available.plugins && sel.plugins && sel.plugins.length < available.plugins.length) {
    filters.pluginNames = new Set(sel.plugins);
  }
  return filters;
}

function tryOpenBrowser(url: string): void {
  try {
    const cmd =
      process.platform === 'win32'  ? `start "" "${url}"` :
      process.platform === 'darwin' ? `open "${url}"` :
                                      `xdg-open "${url}"`;
    cp.exec(cmd);
  } catch {
    // Non-fatal — user can open manually
  }
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── HTML ──────────────────────────────────────────────────────────────────────

function renderBreadcrumb(name: string): string {
  const parts = name.split(/[/\\]/);
  if (parts.length === 1) {
    return `<span class="path-name">${esc(name)}</span>`;
  }
  const dirParts = parts.slice(0, -1);
  const fileName = parts[parts.length - 1];
  const breadcrumbs = dirParts
    .map((part) => `<span class="path-breadcrumb">${esc(part)}</span>`)
    .join(`<span class="path-sep">›</span>`);
  return `${breadcrumbs}<span class="path-sep">›</span><span class="path-name">${esc(fileName)}</span>`;
}

/** Render a flat list of items as checkboxes. */
function renderFlatItems(kind: string, names: string[]): string {
  return names
    .map(
      (n) => `
        <label class="item" title="${esc(n)}">
          <input type="checkbox" data-kind="${kind}" value="${esc(n)}" checked>
          <span class="name">${renderBreadcrumb(n)}</span>
        </label>`,
    )
    .join('');
}

/**
 * Render items that may have nested directory paths.
 * Top-level items that have children become collapsible sections.
 */
function renderCollapsibleItems(kind: string, names: string[]): string {
  // Partition into roots (no separator) and children (have separator)
  const rootSet = new Set(names.filter((n) => !n.includes('/') && !n.includes('\\')));

  // Map each root to its list of children
  const childrenMap = new Map<string, string[]>();
  for (const root of rootSet) childrenMap.set(root, []);

  for (const name of names) {
    if (rootSet.has(name)) continue;
    const sep = name.includes('/') ? '/' : '\\';
    const root = name.split(sep)[0];
    if (childrenMap.has(root)) {
      childrenMap.get(root)!.push(name);
    }
  }

  let html = '';
  for (const [rootName, children] of childrenMap) {
    if (children.length === 0) {
      // Simple standalone item
      html += `
        <label class="item" title="${esc(rootName)}">
          <input type="checkbox" data-kind="${kind}" value="${esc(rootName)}" checked>
          <span class="name">${esc(rootName)}</span>
        </label>`;
    } else {
      // Collapsible directory
      const safeId = `${kind}-${rootName.replace(/[^a-zA-Z0-9]/g, '-')}`;
      const childHtml = children
        .map(
          (child) => `
        <label class="item child-item" title="${esc(child)}">
          <input type="checkbox" data-kind="${kind}" value="${esc(child)}" data-parent="${esc(rootName)}" checked>
          <span class="name">${renderBreadcrumb(child)}</span>
        </label>`,
        )
        .join('');

      html += `
        <div class="dir-group" id="dir-${safeId}">
          <div class="dir-row">
            <label class="item" title="${esc(rootName)}">
              <input type="checkbox" data-kind="${kind}" value="${esc(rootName)}" data-dir="${esc(rootName)}" checked>
              <span class="name">${esc(rootName)}</span>
            </label>
            <button class="expand-btn" onclick="toggleDir('${safeId}')" title="Expand/collapse">
              <span class="expand-icon">▶</span><span class="child-badge">${children.length}</span>
            </button>
          </div>
          <div class="dir-children" id="children-${safeId}" hidden>${childHtml}</div>
        </div>`;
    }
  }
  return html;
}

function renderGroup(
  kind: string,
  title: string,
  colorVar: string,
  names: string[],
): string {
  // Use collapsible rendering if any root item has children in the list
  const rootSet = new Set(names.filter((n) => !n.includes('/') && !n.includes('\\')));
  const hasCollapsible = [...rootSet].some((root) =>
    names.some((n) => n.startsWith(root + '/') || n.startsWith(root + '\\')),
  );

  let bodyHtml: string;
  if (names.length === 0) {
    bodyHtml = `<div class="empty">No ${title.toLowerCase()} found</div>`;
  } else if (hasCollapsible) {
    bodyHtml = renderCollapsibleItems(kind, names);
  } else {
    bodyHtml = renderFlatItems(kind, names);
  }

  return `
  <div class="group" id="grp-${kind}">
    <div class="group-head">
      <span class="badge" style="--c:${colorVar}">${title}</span>
      <span class="grp-count" id="cnt-${kind}"><b>${names.length}</b>/${names.length}</span>
      ${names.length > 0 ? `<button class="toggle-btn" onclick="toggleGroup('${kind}')">toggle all</button>` : ''}
    </div>
    <div class="group-body">${bodyHtml}</div>
  </div>`;
}

function buildHtml(items: UiItems, action: 'push' | 'pull'): string {
  const actionLabel = action === 'push' ? 'Push to Pocket' : 'Pull from Pocket';
  const actionVerb  = action === 'push' ? 'push'           : 'pull';
  const itemsJson   = JSON.stringify(items);

  const groups = [
    renderGroup('agents',  'Agents',       'var(--blue)',    items.agents),
    renderGroup('skills',  'Skills',       'var(--purple)',  items.skills),
    renderGroup('mcps',    'AI Providers', 'var(--green)',   items.mcps),
    ...(items.plugins && items.plugins.length > 0 ? [renderGroup('plugins', 'Plugins', 'var(--yellow)', items.plugins)] : []),
  ].join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>mcpocket — ${actionVerb}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d1117;--surface:#161b22;--border:#30363d;
  --text:#e6edf3;--muted:#8b949e;
  --blue:#58a6ff;--green:#3fb950;--purple:#bc8cff;--yellow:#d29922;
  --font:'SF Mono','Fira Code','Cascadia Code',ui-monospace,monospace;
}
body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column}

/* header */
header{padding:20px 32px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.logo{font-size:18px;font-weight:700;letter-spacing:-.5px}
.logo em{color:var(--blue);font-style:normal}
.logo span{color:var(--purple)}
.subtitle{font-size:12px;color:var(--muted);margin-top:3px}

/* main */
main{flex:1;padding:24px 32px;max-width:760px;width:100%;margin:0 auto;display:flex;flex-direction:column;gap:16px}

/* groups */
.group{background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden}
.group-head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);background:rgba(255,255,255,.02)}
.badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:color-mix(in srgb,var(--c) 18%,transparent);color:var(--c)}
.grp-count{font-size:12px;color:var(--muted);margin-left:auto}
.grp-count b{color:var(--text)}
.toggle-btn{font-family:var(--font);font-size:11px;color:var(--blue);background:none;border:none;cursor:pointer;padding:3px 8px;border-radius:4px}
.toggle-btn:hover{background:rgba(88,166,255,.12)}
.group-body{padding:6px 0}

/* flat items */
.item{display:flex;align-items:center;gap:11px;padding:7px 14px;cursor:pointer;transition:background .1s}
.item:hover{background:rgba(255,255,255,.04)}
.item input[type=checkbox]{width:14px;height:14px;accent-color:var(--blue);cursor:pointer;flex-shrink:0}
.name{font-size:13px;display:flex;align-items:center;gap:2px;flex-wrap:wrap}
.path-breadcrumb{color:var(--muted);font-size:0.9em}
.path-sep{color:var(--muted);margin:0 1px}
.path-name{color:var(--text);font-weight:500}
.empty{padding:14px;font-size:12px;color:var(--muted);text-align:center;font-style:italic}

/* collapsible directories */
.dir-group{border-bottom:1px solid rgba(255,255,255,.04)}
.dir-group:last-child{border-bottom:none}
.dir-row{display:flex;align-items:center;background:rgba(255,255,255,.015)}
.dir-row .item{flex:1}
.expand-btn{font-family:var(--font);font-size:11px;color:var(--muted);background:none;border:none;cursor:pointer;padding:6px 12px;display:flex;align-items:center;gap:5px;border-radius:4px;margin-right:4px;white-space:nowrap}
.expand-btn:hover{color:var(--text)}
.expand-icon{font-size:10px;transition:transform .15s;display:inline-block}
.expand-btn.expanded .expand-icon{transform:rotate(90deg)}
.child-badge{font-size:10px;color:var(--muted);background:rgba(255,255,255,.08);padding:1px 5px;border-radius:3px}
.dir-children{border-top:1px solid rgba(255,255,255,.04)}
.child-item{padding-left:30px}

/* footer */
footer{position:sticky;bottom:0;background:var(--bg);border-top:1px solid var(--border);padding:14px 32px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.summary{font-size:13px;color:var(--muted)}
.summary b{color:var(--text)}
.sync-btn{padding:9px 22px;background:var(--blue);color:#0d1117;border:none;border-radius:6px;font-family:var(--font);font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s}
.sync-btn:hover{opacity:.88}
.sync-btn:disabled{opacity:.35;cursor:default}

/* done screen */
#done{display:none;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:48px}
#done.show{display:flex}
.done-icon{font-size:52px}
.done-msg{font-size:20px;color:var(--green);font-weight:600}
.done-sub{font-size:13px;color:var(--muted)}
</style>
</head>
<body>

<header>
  <div>
    <div class="logo"><em>mcp</em><span>pocket</span></div>
    <div class="subtitle">Select items to ${actionVerb} → pocket</div>
  </div>
</header>

<main id="main">${groups}</main>

<div id="done">
  <div class="done-icon">✓</div>
  <div class="done-msg">Selection submitted!</div>
  <div class="done-sub">Check your terminal to complete the ${actionVerb}.</div>
</div>

<footer id="foot">
  <div class="summary" id="summary"></div>
  <button class="sync-btn" id="sync-btn" onclick="submitSel()">${actionLabel}</button>
</footer>

<script>
const ITEMS=${itemsJson};

function countFor(kind){
  return document.querySelectorAll('[data-kind='+kind+']:checked').length;
}
function updateCounts(){
  let total=0,sel=0;
  const kinds=['agents','skills','mcps'];
  if(ITEMS.plugins) kinds.push('plugins');
  kinds.forEach(k=>{
    const all=ITEMS[k]?.length || 0, s=countFor(k);
    total+=all; sel+=s;
    const el=document.getElementById('cnt-'+k);
    if(el) el.innerHTML='<b>'+s+'</b>/'+all;
  });
  document.getElementById('summary').innerHTML=
    '<b>'+sel+'</b> of <b>'+total+'</b> items selected';
}

function toggleGroup(kind){
  const boxes=[...document.querySelectorAll('[data-kind='+kind+']')];
  const allOn=boxes.every(b=>b.checked);
  boxes.forEach(b=>{b.checked=!allOn;b.indeterminate=false;});
  updateCounts();
}

function toggleDir(safeId){
  const children=document.getElementById('children-'+safeId);
  const btn=document.querySelector('#dir-'+safeId+' .expand-btn');
  const wasHidden=children.hidden;
  children.hidden=!wasHidden;
  btn.classList.toggle('expanded',wasHidden);
}

document.addEventListener('change',function(e){
  const cb=e.target;
  if(!cb||cb.type!=='checkbox') return;

  if(cb.dataset.dir){
    // Parent directory toggled — sync all children
    const children=[...document.querySelectorAll('[data-parent="'+cb.dataset.dir+'"]')];
    children.forEach(c=>{c.checked=cb.checked;c.indeterminate=false;});
  } else if(cb.dataset.parent){
    // Child toggled — update parent state
    const parentCb=document.querySelector('[data-dir="'+cb.dataset.parent+'"]');
    if(parentCb){
      const siblings=[...document.querySelectorAll('[data-parent="'+cb.dataset.parent+'"]')];
      const checkedCount=siblings.filter(s=>s.checked).length;
      const allChecked=checkedCount===siblings.length;
      const someChecked=checkedCount>0;
      parentCb.indeterminate=someChecked&&!allChecked;
      parentCb.checked=allChecked;
    }
  }

  updateCounts();
});

async function submitSel(){
  const sel={agents:[],skills:[],mcps:[]};
  const kinds=['agents','skills','mcps'];
  if(ITEMS.plugins) {
    sel.plugins=[];
    kinds.push('plugins');
  }
  kinds.forEach(k=>{
    document.querySelectorAll('[data-kind='+k+']:checked')
      .forEach(b=>sel[k].push(b.value));
  });
  const btn=document.getElementById('sync-btn');
  btn.disabled=true; btn.textContent='Syncing…';
  try{
    await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sel)});
    document.getElementById('main').style.display='none';
    document.getElementById('foot').style.display='none';
    document.getElementById('done').classList.add('show');
  }catch{
    btn.disabled=false; btn.textContent='${actionLabel}';
    alert('Could not reach the mcpocket server — is the terminal still running?');
  }
}

updateCounts();
</script>
</body>
</html>`;
}
