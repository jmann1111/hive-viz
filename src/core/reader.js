// Multi-window file reader - free-floating, draggable, stackable

const windows = [];
let topZIndex = 100;
let cascadeOffset = 0;

export function initReader() {
  // Nothing to init - windows are created on demand
}

export function openReader(nodeId, tesseract) {
  // Check if already open
  const existing = windows.find(w => w.nodeId === nodeId);
  if (existing) {
    bringToFront(existing);
    return;
  }

  const node = tesseract.getNode(nodeId);
  if (!node) return;

  const win = createWindow(node);
  windows.push(win);
  document.body.appendChild(win.el);
  bringToFront(win);
}

export function closeReader() {
  // Close topmost window
  if (windows.length === 0) return;
  const topWin = windows.reduce((a, b) =>
    parseInt(a.el.style.zIndex) > parseInt(b.el.style.zIndex) ? a : b
  );
  removeWindow(topWin);
}

export function isReaderOpen() {
  return windows.length > 0;
}

function removeWindow(win) {
  win.el.remove();
  const idx = windows.indexOf(win);
  if (idx >= 0) windows.splice(idx, 1);
}

function bringToFront(win) {
  topZIndex++;
  win.el.style.zIndex = topZIndex;
}

function createWindow(node) {
  const el = document.createElement('div');
  el.className = 'rw-window';

  // Cascade position
  const baseX = Math.max(360, window.innerWidth / 2 - 300);
  const baseY = Math.max(40, window.innerHeight / 2 - 250);
  cascadeOffset = (cascadeOffset + 30) % 180;
  el.style.left = (baseX + cascadeOffset) + 'px';
  el.style.top = (baseY + cascadeOffset) + 'px';

  const content = node.content || 'No content available.';

  el.innerHTML = `
    <div class="rw-titlebar">
      <span class="rw-title">${escapeHtml(node.title || node.id)}</span>
      <div class="rw-controls">
        <a class="rw-obsidian" href="obsidian://open?vault=The-Hive&file=${encodeURIComponent((node.path || '').replace('.md', ''))}" title="Open in Obsidian">&#x2197;</a>
        <button class="rw-close">&times;</button>
      </div>
    </div>
    <div class="rw-meta">
      <span class="rw-badge">${node.folder}</span>
      ${node.type && node.type !== 'unknown' ? `<span class="rw-badge">${node.type}</span>` : ''}
      <span class="rw-badge">${node.linkCount || 0} links</span>
    </div>
    <div class="rw-body">${formatMarkdown(content)}</div>
    <div class="rw-resize-handle"></div>
  `;

  const win = { el, nodeId: node.id };

  // Close button
  el.querySelector('.rw-close').addEventListener('click', () => removeWindow(win));

  // Click to bring to front
  el.addEventListener('mousedown', () => bringToFront(win));

  // Draggable titlebar
  const titlebar = el.querySelector('.rw-titlebar');
  let dragOffset = null;

  titlebar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.rw-controls')) return; // don't drag from buttons
    e.preventDefault();
    dragOffset = { x: e.clientX - el.offsetLeft, y: e.clientY - el.offsetTop };
    bringToFront(win);

    const onMove = (e) => {
      el.style.left = Math.max(0, e.clientX - dragOffset.x) + 'px';
      el.style.top = Math.max(0, e.clientY - dragOffset.y) + 'px';
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // Resizable from bottom-right corner
  const resizeHandle = el.querySelector('.rw-resize-handle');
  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = el.offsetWidth, startH = el.offsetHeight;

    const onMove = (e) => {
      el.style.width = Math.max(300, startW + e.clientX - startX) + 'px';
      el.style.height = Math.max(200, startH + e.clientY - startY) + 'px';
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // Stop propagation so clicks don't hit 3D canvas
  el.addEventListener('click', (e) => e.stopPropagation());

  return win;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatMarkdown(text) {
  return text
    .split('\n')
    .map(line => {
      if (line.match(/^#{1,6}\s/)) {
        const level = line.match(/^(#+)/)[1].length;
        const content = line.replace(/^#+\s*/, '');
        return `<h${level} class="rw-h">${escapeHtml(content)}</h${level}>`;
      }
      if (line.startsWith('```')) return '<hr class="rw-code-sep">';
      if (line.match(/^[-*]\s/)) return `<div class="rw-li">${formatInline(escapeHtml(line.replace(/^[-*]\s/, '')))}</div>`;
      if (line.match(/^\d+\.\s/)) return `<div class="rw-li">${formatInline(escapeHtml(line))}</div>`;
      if (line.trim() === '') return '<br>';
      return `<p class="rw-p">${formatInline(escapeHtml(line))}</p>`;
    })
    .join('');
}

function formatInline(text) {
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/`(.+?)`/g, '<code class="rw-code">$1</code>');
  text = text.replace(/\[\[([^\]]+?)\]\]/g, '<span class="rw-wikilink">$1</span>');
  return text;
}
