import * as http from 'node:http';
import * as cp from 'node:child_process';
import type { ItemFilters } from './item-select.js';
import { sparkle, oops, c } from '../utils/sparkle.js';
import { findDuplicateAgents, removeAgentFromCopilot } from '../sync/agents.js';
import { findDuplicateSkills, removeSkillFromGemini } from '../sync/skills.js';

const PORT = 3000;

export interface UiItems {
  agents: string[];
  skills: string[];
  mcps:   string[];
  plugins?: string[];
  aiProviders?: string[];
  agentProviders?: Record<string, string>;
  skillProviders?: Record<string, string>;
  providers?: Array<{ id: string; displayName: string; color: string }>;
  projects?: Record<string, string[]>;
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
        // Pass providers to the HTML builder for rendering and filtering
        res.end(buildHtml(items, action, items.providers));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/items') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...items, action }));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/dedupe-preview') {
        const dupes = [
          ...findDuplicateAgents().map((d) => ({ ...d, kind: 'agent' as const })),
          ...findDuplicateSkills().map((d) => ({ ...d, kind: 'skill' as const })),
        ];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ dupes }));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/dedupe') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const { dupes }: { dupes: Array<{ name: string; kind: 'agent' | 'skill' }> } = JSON.parse(body);
            let removed = 0;
            for (const d of dupes) {
              if (d.kind === 'agent' && removeAgentFromCopilot(d.name)) removed++;
              if (d.kind === 'skill' && removeSkillFromGemini(d.name)) removed++;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, removed }));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/api/sync') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const sel: { agents: string[]; skills: string[]; mcps: string[]; plugins?: string[]; aiProviders?: string[]; providers?: string[] } = JSON.parse(body);
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
  sel: { agents: string[]; skills: string[]; mcps: string[]; plugins?: string[]; aiProviders?: string[]; providers?: string[]; projects?: string[] },
  available: UiItems,
): ItemFilters {
  const filters: ItemFilters = {};
  if (sel.agents.length < available.agents.length) filters.agentNames = new Set(sel.agents);
  if (sel.skills.length < available.skills.length) filters.skillNames = new Set(sel.skills);
  if (sel.mcps.length   < available.mcps.length)   filters.mcpNames   = new Set(sel.mcps);
  if (available.plugins && sel.plugins && sel.plugins.length < available.plugins.length) {
    filters.pluginNames = new Set(sel.plugins);
  }
  if (available.aiProviders && sel.aiProviders && sel.aiProviders.length < available.aiProviders.length) {
    filters.aiProviderNames = new Set(sel.aiProviders);
  }
  if (available.providers && sel.providers && sel.providers.length < available.providers.length) {
    filters.selectedProviders = new Set(sel.providers);
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

/** Render the Providers group (first in the UI). */
function renderProvidersGroup(providers?: Array<{ id: string; displayName: string; color: string }>): string {
  if (!providers || providers.length === 0) return '';
  const itemsHtml = providers.map((p) => {
    const id = esc(p.id);
    const display = esc(p.displayName);
    const color = esc(p.color);
    // Badge with colored badge using provider color
    return `
      <label class="item" title="${display}" data-provider-id="${id}" data-provider="${id}">
        <input type="checkbox" data-kind="providers" value="${id}" checked>
        <span class="name">${display}
          <span class="provider-badge" style="--c:${color}; background: color-mix(in srgb, ${color} 18%, transparent); color:#fff; margin-left:6px;">${display}</span>
        </span>
      </label>`;
  }).join('');
  return `
  <div class="group" id="grp-providers">
    <div class="group-head">
      <span class="badge" style="--c:var(--blue)">Providers</span>
      <span class="grp-count" id="cnt-providers"><b>${providers.length}</b>/${providers.length}</span>
    </div>
    <div class="group-body">${itemsHtml}</div>
  </div>`;
}

function renderProviderBadge(provider: string | undefined): string {
  if (!provider) return '';
  return `<span class="provider-badge provider-${esc(provider)}">${esc(provider)}</span>`;
}

function providerToAsset(providerId: string): string {
  if (providerId === 'claude-code' || providerId === 'claude-desktop') return 'claude';
  if (providerId === 'copilot-cli') return 'copilot';
  if (providerId === 'gemini-cli' || providerId === 'antigravity') return 'gemini';
  return providerId;
}

/** Render a flat list of items as checkboxes. */
function renderFlatItems(kind: string, names: string[], providers?: Record<string, string>): string {
  return names
    .map((n) => {
      const pid = providers?.[n] ?? '';
      const asset = providerToAsset(pid);
      return `
        <label class="item" title="${esc(n)}" data-provider="${esc(pid)}" data-provider-asset="${esc(asset)}">
          <input type="checkbox" data-kind="${kind}" value="${esc(n)}" checked>
          <span class="name">${renderBreadcrumb(n)}${renderProviderBadge(pid)}</span>
        </label>`;
    })
    .join('');
}

/**
 * Render items that may have nested directory paths.
 * Top-level items that have children become collapsible sections.
 */
function renderCollapsibleItems(kind: string, names: string[], providers?: Record<string, string>): string {
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
    const rootProvider = providers?.[rootName];
    if (children.length === 0) {
      // Simple standalone item
      const rootPid = rootProvider || '';
        const rootAsset = providerToAsset(rootPid);
      html += `
        <label class="item" title="${esc(rootName)}" data-provider="${esc(rootPid)}" data-provider-asset="${esc(rootAsset)}">
          <input type="checkbox" data-kind="${kind}" value="${esc(rootName)}" data-dir="${esc(rootName)}" checked>
          <span class="name">${esc(rootName)}${renderProviderBadge(rootPid)}</span>
        </label>`;
    } else {
      // Collapsible directory
      const safeId = `${kind}-${rootName.replace(/[^a-zA-Z0-9]/g, '-')}`;
        const childHtml = children
          .map(
          (child) => {
            const cpid = providers?.[child] ?? '';
            const casset = providerToAsset(cpid);
            return `
        <label class="item child-item" title="${esc(child)}" data-provider="${esc(cpid)}" data-provider-asset="${esc(casset)}">
          <input type="checkbox" data-kind="${kind}" value="${esc(child)}" data-parent="${esc(rootName)}" checked>
          <span class="name">${renderBreadcrumb(child)}${renderProviderBadge(cpid)}</span>
        </label>`;
          },
          )
          .join('');

        // Build root provider asset for the collapsible group root
        const rootPid = rootProvider || '';
        const rootAsset: string = providerToAsset(rootPid);
        html += `
        <div class="dir-group" id="dir-${safeId}">
          <div class="dir-row">
            <label class="item" title="${esc(String(rootName))}" data-provider="${esc(rootPid)}" data-provider-asset="${esc(rootAsset)}">
              <input type="checkbox" data-kind="${kind}" value="${esc(String(rootName))}" data-dir="${esc(String(rootName))}" checked>
              <span class="name">${esc(String(rootName))}${renderProviderBadge(rootProvider)}</span>
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
  providers?: Record<string, string>,
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
    bodyHtml = renderCollapsibleItems(kind, names, providers);
  } else {
    bodyHtml = renderFlatItems(kind, names, providers);
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

function renderProjectsGroup(projects: Record<string, string[]>): string {
  const projectEntries = Object.entries(projects);
  const itemsHtml = projectEntries.map(([name, files]) => {
    const fileCount = files.length;
    return `
      <label class="item" title="${esc(name)}" data-provider="project">
        <input type="checkbox" data-kind="projects" value="${esc(name)}" checked>
        <span class="name">${esc(name)} <span class="child-badge">${fileCount} file${fileCount === 1 ? '' : 's'}</span></span>
      </label>`;
  }).join('');

  return `
  <div class="group" id="grp-projects">
    <div class="group-head">
      <span class="badge" style="--c:var(--orange)">Projects</span>
      <span class="grp-count" id="cnt-projects"><b>${projectEntries.length}</b>/${projectEntries.length}</span>
    </div>
    <div class="group-body">${itemsHtml}</div>
  </div>`;
}

function renderProviderSection(
  provider: { id: string; displayName: string; color: string },
  agents: string[],
  skills: string[],
  agentProviders?: Record<string, string>,
  skillProviders?: Record<string, string>,
): string {
  const safeId = `provider-${provider.id.replace(/[^a-zA-Z0-9]/g, '-')}`;
  const totalItems = agents.length + skills.length;

  let bodyHtml = '';

  if (agents.length > 0) {
    bodyHtml += `<div class="sub-group"><div class="sub-group-head"><span class="sub-badge" style="--c:var(--blue)">Agents</span><span class="sub-count">${agents.length}</span></div>`;
    bodyHtml += agents.map(n => {
      const pid = agentProviders?.[n] ?? '';
      return `
        <label class="item child-item" title="${esc(n)}" data-provider="${esc(pid)}">
          <input type="checkbox" data-kind="agents" value="${esc(n)}" data-parent-provider="${esc(provider.id)}" checked>
          <span class="name">${esc(n)}${renderProviderBadge(pid)}</span>
        </label>`;
    }).join('');
    bodyHtml += '</div>';
  }

  if (skills.length > 0) {
    bodyHtml += `<div class="sub-group"><div class="sub-group-head"><span class="sub-badge" style="--c:var(--purple)">Skills</span><span class="sub-count">${skills.length}</span></div>`;
    bodyHtml += skills.map(n => {
      const pid = skillProviders?.[n] ?? '';
      return `
        <label class="item child-item" title="${esc(n)}" data-provider="${esc(pid)}">
          <input type="checkbox" data-kind="skills" value="${esc(n)}" data-parent-provider="${esc(provider.id)}" checked>
          <span class="name">${esc(n)}${renderProviderBadge(pid)}</span>
        </label>`;
    }).join('');
    bodyHtml += '</div>';
  }

  if (!bodyHtml) {
    bodyHtml = `<div class="empty">No agents or skills for this provider</div>`;
  }

  return `
  <div class="group provider-group" id="grp-${safeId}">
    <div class="group-head">
      <span class="badge" style="--c:${esc(provider.color)}">${esc(provider.displayName)}</span>
      <span class="grp-count" id="cnt-${safeId}"><b>${totalItems}</b>/${totalItems}</span>
      ${totalItems > 0 ? `<button class="toggle-btn" onclick="toggleGroup('${safeId}')">toggle all</button>` : ''}
    </div>
    <div class="group-body">${bodyHtml}</div>
  </div>`;
}

function buildHtml(
  items: UiItems,
  action: 'push' | 'pull',
  providers?: Array<{ id: string; displayName: string; color: string }>,
): string {
  const actionLabel = action === 'push' ? 'Push to Pocket' : 'Pull from Pocket';
  const actionVerb  = action === 'push' ? 'push'           : 'pull';
  const itemsJson   = JSON.stringify(items);

  const groups: string[] = [];

  // Projects
  if (items.projects && Object.keys(items.projects).length > 0) {
    groups.push(renderProjectsGroup(items.projects));
  }

  // Providers with nested agents/skills
  if (providers && providers.length > 0) {
    for (const provider of providers) {
      const providerAgents = items.agents.filter(a => items.agentProviders?.[a] === provider.id);
      const providerSkills = items.skills.filter(s => items.skillProviders?.[s] === provider.id);
      groups.push(renderProviderSection(provider, providerAgents, providerSkills, items.agentProviders, items.skillProviders));
    }
  }

  // MCP Servers (shared across all providers)
  groups.push(renderGroup('mcps', 'MCP Servers', 'var(--green)', items.mcps));

  // Plugins
  if (items.plugins && items.plugins.length > 0) {
    groups.push(renderGroup('plugins', 'Plugins', 'var(--yellow)', items.plugins));
  }

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
  --blue:#58a6ff;--green:#3fb950;--purple:#bc8cff;--yellow:#d29922;--orange:#fb8500;
  --red:#f85149;
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

/* provider badges */
.provider-badge{font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;margin-left:8px;letter-spacing:.3px}
.provider-claude{background:rgba(56,189,248,.14);color:#38bdf8}
.provider-copilot{background:rgba(139,148,158,.15);color:#8b949e}
.provider-gemini{background:rgba(167,139,250,.15);color:#a78bfa}
.provider-opencode{background:rgba(251,133,0,.14);color:#fb8500}
.provider-group{border-left:3px solid var(--c)}
.sub-group{border-top:1px solid rgba(255,255,255,.04)}
.sub-group:first-child{border-top:none}
.sub-group-head{display:flex;align-items:center;gap:8px;padding:6px 14px 2px}
.sub-badge{font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;background:color-mix(in srgb,var(--c) 18%,transparent);color:var(--c)}
.sub-count{font-size:10px;color:var(--muted);margin-left:auto}

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
.footer-actions{display:flex;align-items:center;gap:10px}
.dedupe-btn{padding:9px 16px;background:none;color:var(--muted);border:1px solid var(--border);border-radius:6px;font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s}
.dedupe-btn:hover{color:var(--text);border-color:var(--muted)}
.sync-btn{padding:9px 22px;background:var(--blue);color:#0d1117;border:none;border-radius:6px;font-family:var(--font);font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s}
.sync-btn:hover{opacity:.88}
.sync-btn:disabled{opacity:.35;cursor:default}

/* done screen */
#done{display:none;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:48px}
#done.show{display:flex}
.done-icon{font-size:52px}
.done-msg{font-size:20px;color:var(--green);font-weight:600}
.done-sub{font-size:13px;color:var(--muted)}

/* dedupe modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:100}
.modal-overlay[hidden]{display:none}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:10px;width:520px;max-width:calc(100vw - 48px);max-height:80vh;display:flex;flex-direction:column;overflow:hidden}
.modal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border)}
.modal-head h3{font-size:14px;font-weight:600}
.modal-close{background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;line-height:1;padding:2px 6px;border-radius:4px}
.modal-close:hover{color:var(--text);background:rgba(255,255,255,.08)}
.modal-body{padding:16px 18px;overflow-y:auto;flex:1;font-size:13px}
.modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid var(--border)}
.cancel-btn{padding:7px 16px;background:none;color:var(--text);border:1px solid var(--border);border-radius:6px;font-family:var(--font);font-size:13px;cursor:pointer}
.cancel-btn:hover{background:rgba(255,255,255,.06)}
.confirm-btn{padding:7px 16px;background:var(--red);color:#fff;border:none;border-radius:6px;font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s}
.confirm-btn:hover{opacity:.85}
.confirm-btn:disabled{opacity:.4;cursor:default}
.dupe-list{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.dupe-item{background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:6px;padding:10px 12px}
.dupe-name{font-weight:600;margin-bottom:4px}
.dupe-detail{font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:2px}
.dupe-keep{color:var(--green)}
.dupe-remove{color:var(--red)}
.dupe-kind{font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;margin-left:6px;vertical-align:middle}
.dupe-kind-agent{background:rgba(88,166,255,.14);color:var(--blue)}
.dupe-kind-skill{background:rgba(188,140,255,.14);color:var(--purple)}
.modal-empty{color:var(--muted);text-align:center;padding:20px 0;font-style:italic}
.modal-success{color:var(--green);text-align:center;padding:20px 0;font-size:14px}
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

<!-- Dedupe modal -->
<div id="dedupe-modal" class="modal-overlay" hidden>
  <div class="modal">
    <div class="modal-head">
      <h3>Remove Local Duplicates</h3>
      <button class="modal-close" onclick="closeDedupeModal()" title="Close">✕</button>
    </div>
    <div class="modal-body" id="dedupe-body">
      <p style="color:var(--muted);font-size:12px">Scanning for duplicates…</p>
    </div>
    <div class="modal-foot">
      <button class="cancel-btn" onclick="closeDedupeModal()">Cancel</button>
      <button class="confirm-btn" id="confirm-dedupe-btn" onclick="confirmDedupe()" disabled>Remove Duplicates</button>
    </div>
  </div>
</div>

<footer id="foot">
  <div class="summary" id="summary"></div>
  <div class="footer-actions">
    <button class="dedupe-btn" onclick="openDedupeModal()">Dedupe local</button>
    <button class="sync-btn" id="sync-btn" onclick="submitSel()">${actionLabel}</button>
  </div>
</footer>

<script>
const ITEMS=${itemsJson};
let _dupes=[];

function countFor(kind){
  return document.querySelectorAll('[data-kind='+kind+']:checked').length;
}
function updateCounts(){
  let total=0,sel=0;
  const kinds=[];
  if(ITEMS.projects) kinds.push('projects');
  if(ITEMS.providers) kinds.push('providers');
  if(ITEMS.aiProviders) kinds.push('aiProviders');
  kinds.push('agents','skills','mcps');
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
  if(ITEMS.projects) {
    sel.projects=[];
    kinds.unshift('projects');
  }
  if(ITEMS.aiProviders) {
    sel.aiProviders=[];
    kinds.unshift('aiProviders');
  }
  if(ITEMS.plugins) {
    sel.plugins=[];
    kinds.push('plugins');
  }
  if(ITEMS.providers) {
    sel.providers=[];
    kinds.unshift('providers');
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

// ── Dedupe ───────────────────────────────────────────────────────────────────

async function openDedupeModal(){
  const modal=document.getElementById('dedupe-modal');
  const body=document.getElementById('dedupe-body');
  const confirmBtn=document.getElementById('confirm-dedupe-btn');
  body.innerHTML='<p style="color:var(--muted);font-size:12px">Scanning for duplicates…</p>';
  confirmBtn.disabled=true;
  _dupes=[];
  modal.hidden=false;
  try{
    const res=await fetch('/api/dedupe-preview');
    const data=await res.json();
    _dupes=data.dupes||[];
    renderDedupeBody(_dupes);
    confirmBtn.disabled=_dupes.length===0;
  }catch{
    body.innerHTML='<p style="color:var(--red);font-size:12px">Failed to scan for duplicates.</p>';
  }
}

function renderDedupeBody(dupes){
  const body=document.getElementById('dedupe-body');
  if(dupes.length===0){
    body.innerHTML='<div class="modal-empty">No local duplicates found.</div>';
    return;
  }
  const intro='<p style="font-size:12px;color:var(--muted);margin-bottom:12px">'+
    'These items exist in multiple provider directories. The primary copy (Claude) will be kept; the duplicate will be removed.</p>';
  const list=dupes.map(d=>{
    const kindCls='dupe-kind-'+d.kind;
    return '<div class="dupe-item">'+
      '<div class="dupe-name">'+escHtml(d.name)+'<span class="dupe-kind '+kindCls+'">'+d.kind+'</span></div>'+
      '<div class="dupe-detail">'+
        '<span class="dupe-keep">keep: '+escHtml(d.keepIn)+'</span>'+
        '<span class="dupe-remove">remove: '+escHtml(d.removeFrom)+escHtml(d.name)+'</span>'+
      '</div>'+
    '</div>';
  }).join('');
  body.innerHTML=intro+'<div class="dupe-list">'+list+'</div>';
}

async function confirmDedupe(){
  const confirmBtn=document.getElementById('confirm-dedupe-btn');
  const cancelBtn=document.querySelector('#dedupe-modal .cancel-btn');
  confirmBtn.disabled=true;
  confirmBtn.textContent='Removing…';
  cancelBtn.disabled=true;
  try{
    const res=await fetch('/api/dedupe',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({dupes:_dupes.map(d=>({name:d.name,kind:d.kind}))})
    });
    const data=await res.json();
    document.getElementById('dedupe-body').innerHTML=
      '<div class="modal-success">Removed '+data.removed+' duplicate'+(data.removed===1?'':'s')+'.</div>';
    confirmBtn.style.display='none';
    cancelBtn.disabled=false;
    cancelBtn.textContent='Close';
  }catch{
    document.getElementById('dedupe-body').innerHTML=
      '<p style="color:var(--red);font-size:12px">Failed to remove duplicates.</p>';
    confirmBtn.disabled=false;
    confirmBtn.textContent='Remove Duplicates';
    cancelBtn.disabled=false;
  }
}

function closeDedupeModal(){
  document.getElementById('dedupe-modal').hidden=true;
  const confirmBtn=document.getElementById('confirm-dedupe-btn');
  const cancelBtn=document.querySelector('#dedupe-modal .cancel-btn');
  confirmBtn.style.display='';
  confirmBtn.textContent='Remove Duplicates';
  cancelBtn.textContent='Cancel';
  cancelBtn.disabled=false;
}

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Close modal on overlay click
document.getElementById('dedupe-modal').addEventListener('click',function(e){
  if(e.target===this) closeDedupeModal();
});

updateCounts();
</script>
</body>
</html>`;
}
