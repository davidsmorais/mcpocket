import { c, section, sparkle } from './sparkle.js';
import type { PocketTreeResult } from './pocket-tree.js';

interface TreeNode {
  name: string;
  type: 'file' | 'dir';
  colorFn?: (s: string) => string;
  children?: TreeNode[];
}

function buildTreeFromPaths(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();
  dirMap.set('', { name: '', type: 'dir', children: root });

  for (const filePath of [...paths].sort()) {
    const parts = filePath.split('/');
    let currentPath = '';
    let parentChildren = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (isFile) {
        parentChildren.push({ name: part, type: 'file' });
      } else {
        let dirNode = dirMap.get(currentPath);
        if (!dirNode) {
          dirNode = { name: part, type: 'dir', children: [] };
          dirMap.set(currentPath, dirNode);
          parentChildren.push(dirNode);
        }
        parentChildren = dirNode.children!;
      }
    }
  }

  return root;
}

function printTree(nodes: TreeNode[], prefix: string = ''): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const last = i === nodes.length - 1;
    const connector = last ? '└── ' : '├── ';
    const continuation = last ? '    ' : '│   ';

    if (node.type === 'dir') {
      const displayName = node.colorFn ? node.colorFn(node.name) : node.name;
      console.log(`${prefix}${connector}${c.blue('📂')} ${displayName}/`);
      if (node.children && node.children.length > 0) {
        printTree(node.children, prefix + continuation);
      }
    } else {
      const displayName = node.colorFn ? node.colorFn(node.name) : c.dim(node.name);
      console.log(`${prefix}${connector}${displayName}`);
    }
  }
}

export function renderPocketTree(tree: PocketTreeResult): void {
  section('Pocket Contents');

  const projectNames = Object.keys(tree.projects).sort();
  const agentProviders = Object.keys(tree.providers.agents).sort();
  const skillProviders = Object.keys(tree.providers.skills).sort();
  const hasAnyProviderContent = agentProviders.length > 0 || skillProviders.length > 0;

  // Projects
  console.log(`  ${c.yellow('📁')} ${c.bold('Projects')}`);
  if (projectNames.length > 0) {
    for (let i = 0; i < projectNames.length; i++) {
      const projectName = projectNames[i];
      const last = i === projectNames.length - 1 && !hasAnyProviderContent;
      const connector = last ? '└── ' : '├── ';
      const continuation = last ? '    ' : '│   ';
      const files = tree.projects[projectName].files || [];

      console.log(`    ${connector}${c.blue('📂')} ${c.bold(c.magenta(projectName))}/`);
      if (files.length > 0) {
        const relPaths = files.map(f => f.split('/').slice(1).join('/'));
        const fileTree = buildTreeFromPaths(relPaths);
        printTree(fileTree, `    ${continuation}`);
      } else {
        console.log(`    ${continuation}${c.dim('(empty)')}`);
      }
    }
  } else {
    const suffix = hasAnyProviderContent ? '' : ` ${c.dim('(no projects tracked)')}`;
    console.log(`    └── ${c.dim('none')}${suffix}`);
  }

  // Providers - Agents
  if (agentProviders.length > 0) {
    console.log(`  ${c.cyan('📁')} ${c.bold('Agents')} ${c.dim(`(${agentProviders.length} categories)`)}`);
    for (let i = 0; i < agentProviders.length; i++) {
      const provider = agentProviders[i];
      const last = i === agentProviders.length - 1 && skillProviders.length === 0;
      const connector = last ? '└── ' : '├── ';
      const continuation = last ? '    ' : '│   ';
      const files = tree.providers.agents[provider] || [];

      console.log(`    ${connector}${c.blue('📂')} ${c.bold(c.cyan(provider))}/ ${c.dim(`(${files.length} files)`)}`);
      if (files.length > 0) {
        const relPaths = files.map(f => {
          const parts = f.split('/');
          return parts.slice(2).join('/');
        });
        const fileTree = buildTreeFromPaths(relPaths);
        printTree(fileTree, `    ${continuation}`);
      }
    }
  }

  // Providers - Skills
  if (skillProviders.length > 0) {
    const hasAgents = agentProviders.length > 0;
    console.log(`  ${c.cyan('📁')} ${c.bold('Skills')} ${c.dim(`(${skillProviders.length} categories)`)}`);
    for (let i = 0; i < skillProviders.length; i++) {
      const provider = skillProviders[i];
      const last = i === skillProviders.length - 1;
      const connector = last ? '└── ' : '├── ';
      const continuation = last ? '    ' : '│   ';
      const files = tree.providers.skills[provider] || [];

      console.log(`    ${connector}${c.blue('📂')} ${c.bold(c.cyan(provider))}/ ${c.dim(`(${files.length} files)`)}`);
      if (files.length > 0) {
        const relPaths = files.map(f => {
          const parts = f.split('/');
          return parts.slice(2).join('/');
        });
        const fileTree = buildTreeFromPaths(relPaths);
        printTree(fileTree, `    ${continuation}`);
      }
    }
  }

  if (!hasAnyProviderContent) {
    sparkle('No provider-specific files synced yet');
  }

  // Shared
  console.log(`\n  ${c.green('📁')} ${c.bold('Shared')}`);
  if (tree.mcpConfig) {
    console.log(`    ${c.cyan('📄')} ${c.dim('mcp-config.json')}`);
  } else {
    console.log(`    ${c.cyan('📄')} ${c.dim('mcp-config.json')} ${c.dim('(not present)')}`);
  }

  if (tree.plugins.length > 0) {
    console.log(`    ${c.blue('📂')} ${c.bold('plugins')}/ ${c.dim(`(${tree.plugins.length} files)`)}`);
    const relPaths = tree.plugins.map(p => p.split('/').slice(1).join('/'));
    const pluginTree = buildTreeFromPaths(relPaths);
    printTree(pluginTree, '    ');
  } else {
    console.log(`    ${c.blue('📂')} ${c.bold('plugins')}/ ${c.dim('(empty)')}`);
  }
}
