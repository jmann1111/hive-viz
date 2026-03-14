import { readdir, readFile, stat, mkdir } from 'fs/promises';
import { join, relative, extname, basename } from 'path';
import { parse as parseYaml } from 'yaml';

const VAULT_PATH = '/Users/jasonmann/Documents/The-Hive-Sync';
const OUTPUT_PATH = join(process.cwd(), 'public', 'graph.json');
const SKIP_DIRS = new Set(['.obsidian', 'node_modules', '99-Assets', '.git', '.trash']);

const FOLDER_ORDER = [
  '00-Inbox', '01-Daily', '10-Sessions', '20-Architecture',
  '30-Projects', '39-Archive', '40-Decisions', '50-Playbooks',
  '60-Knowledge', '70-Ops', '80-Secure', '99-Templates'
];

async function walkDir(dir, rootDir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);
    const topFolder = relPath.split('/')[0];
    if (SKIP_DIRS.has(entry.name) || SKIP_DIRS.has(topFolder)) continue;
    if (entry.isDirectory()) {
      files.push(...await walkDir(fullPath, rootDir));
    } else if (entry.isFile() && extname(entry.name) === '.md') {
      files.push(fullPath);
    }
  }
  return files;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, body: content };
  try {
    const frontmatter = parseYaml(match[1]) || {};
    const body = content.slice(match[0].length);
    return { frontmatter, body };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

function parseWikilinks(body) {
  const links = [];
  // Remove code blocks first
  const cleaned = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '');
  const regex = /\[\[([^\]|#]+?)(?:[|#][^\]]*?)?\]\]/g;
  let m;
  while ((m = regex.exec(cleaned)) !== null) {
    const target = m[1].trim();
    if (target && !links.includes(target)) links.push(target);
  }
  return links;
}

function getTitle(body, filename) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : filename;
}

function countWords(body) {
  return body.split(/\s+/).filter(w => w.length > 0).length;
}

async function processFile(filePath, rootDir) {
  const content = await readFile(filePath, 'utf-8');
  const relPath = relative(rootDir, filePath);
  const folder = relPath.split('/')[0];
  const id = basename(filePath, '.md');
  const { frontmatter, body } = parseFrontmatter(content);

  let created = frontmatter.date || null;
  if (!created) {
    const s = await stat(filePath);
    created = s.birthtime.toISOString().split('T')[0];
  }
  if (created instanceof Date) created = created.toISOString().split('T')[0];
  if (typeof created !== 'string') created = String(created);

  return {
    id,
    path: relPath,
    folder,
    created,
    type: frontmatter.type || 'unknown',
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
    links: parseWikilinks(body),
    wordCount: countWords(body),
    title: getTitle(body, id)
  };
}

async function main() {
  console.log(`Scanning vault at: ${VAULT_PATH}`);
  const files = await walkDir(VAULT_PATH, VAULT_PATH);
  console.log(`Found ${files.length} markdown files`);

  const nodes = [];
  let errors = 0;
  for (const f of files) {
    try {
      nodes.push(await processFile(f, VAULT_PATH));
    } catch (e) {
      errors++;
      console.error(`Error processing ${relative(VAULT_PATH, f)}: ${e.message}`);
    }
  }

  const nodeIndex = new Set(nodes.map(n => n.id));
  const edges = [];
  for (const node of nodes) {
    for (const link of node.links) {
      if (nodeIndex.has(link) && link !== node.id) {
        edges.push({ source: node.id, target: link });
      }
    }
  }

  const dates = nodes.map(n => n.created).filter(Boolean).sort();
  const graph = {
    nodes,
    edges,
    meta: {
      totalFiles: nodes.length,
      totalEdges: edges.length,
      dateRange: [dates[0], dates[dates.length - 1]],
      extractedAt: new Date().toISOString()
    }
  };

  await mkdir(join(process.cwd(), 'public'), { recursive: true });
  const { writeFile: wf } = await import('fs/promises');
  await wf(OUTPUT_PATH, JSON.stringify(graph, null, 2));
  console.log(`\nGraph written to ${OUTPUT_PATH}`);
  console.log(`  Nodes: ${nodes.length}`);
  console.log(`  Edges: ${edges.length}`);
  console.log(`  Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
  console.log(`  Errors: ${errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
