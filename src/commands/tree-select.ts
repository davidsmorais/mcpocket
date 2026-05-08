import { askMultiSelect } from '../utils/prompt.js';
import type { InventoryItem } from '../sync/inventory.js';
import type { Tool, Category, Scope } from '../sync/manifest.js';
import { scopeLabel } from '../sync/manifest.js';

const TOOL_LABEL: Record<Tool, string> = {
  claude: 'Claude',
  copilot: 'Copilot',
  opencode: 'OpenCode',
  gemini: 'Gemini',
};

const CATEGORY_LABEL: Record<Category, string> = {
  settings: 'Settings',
  agents: 'Agents',
  skills: 'Skills',
  plugins: 'Plugins',
  extensions: 'Extensions',
  mcps: 'MCPs',
  files: 'Files',
};

interface FlatRow {
  /** Either an inventory item id (selectable) or a synthetic header id (not in result) */
  id: string;
  isHeader: boolean;
  label: string;
  item?: InventoryItem;
}

function groupKey(it: InventoryItem): string {
  return `${it.tool}::${scopeLabel(it.scope)}::${it.category}`;
}

function buildRows(items: InventoryItem[]): FlatRow[] {
  // Group: tool > scope > category > items
  const sorted = [...items].sort((a, b) => {
    const aKey = `${a.tool}::${scopeLabel(a.scope)}::${a.category}::${a.name}`;
    const bKey = `${b.tool}::${scopeLabel(b.scope)}::${b.category}::${b.name}`;
    return aKey.localeCompare(bKey);
  });

  const rows: FlatRow[] = [];
  let lastTool: Tool | null = null;
  let lastScope: string | null = null;
  let lastCategory: Category | null = null;

  for (const it of sorted) {
    const scopeStr = scopeLabel(it.scope);
    if (it.tool !== lastTool || scopeStr !== lastScope) {
      rows.push({
        id: `__header_tool_${it.tool}_${scopeStr}__`,
        isHeader: true,
        label: `${TOOL_LABEL[it.tool]} — ${scopeStr}`,
      });
      lastTool = it.tool;
      lastScope = scopeStr;
      lastCategory = null;
    }
    if (it.category !== lastCategory) {
      rows.push({
        id: `__header_cat_${it.tool}_${scopeStr}_${it.category}__`,
        isHeader: true,
        label: `  ${CATEGORY_LABEL[it.category]}`,
      });
      lastCategory = it.category;
    }
    rows.push({
      id: it.id,
      isHeader: false,
      label: `    ${it.name}`,
      item: it,
    });
  }
  return rows;
}

/**
 * Show a hierarchical multi-select grouped by tool/scope/category.
 * Headers are presented as non-selectable rows visually; under the hood
 * they're rendered as disabled label-only entries.
 *
 * Returns the set of selected InventoryItem ids.
 */
export async function pickInventoryItems(
  question: string,
  items: InventoryItem[],
): Promise<Set<string>> {
  if (items.length === 0) return new Set();

  const rows = buildRows(items);

  // We can't easily make headers unselectable in the existing askMultiSelect,
  // so we include them as selectable rows but ignore them in the result and
  // map their toggle state to "select all in section" semantics post-hoc.
  // For simplicity here, the user toggles items directly; headers are visual
  // and toggling a header just toggles that row (no-op on the result set).
  const selected = await askMultiSelect<FlatRow>(
    question,
    rows.map((r) => ({ label: r.label, value: r })),
  );

  const result = new Set<string>();
  for (const r of selected) {
    if (!r.isHeader && r.item) result.add(r.item.id);
  }
  return result;
}
