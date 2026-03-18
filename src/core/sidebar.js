// Sidebar file browser - Obsidian-style folder tree
// Pure DOM, keyboard navigable, no framework

import { FOLDER_ORDER } from './tesseract.js';

// Strip number prefixes from folder names: "20-Architecture" -> "Architecture"
function cleanFolderName(folder) {
  return folder.replace(/^\d+-/, '');
}

export function createSidebar(tesseract, onSelect, onSelectCallbacks, openReader, onSearchHighlight) {
  const sidebar = document.getElementById('sidebar');
  const folderMap = tesseract.getNodesByFolder();

  // Build HTML
  sidebar.innerHTML = `
    <div class="sb-search">
      <input id="sidebar-search" type="text" placeholder="Search nodes..." autocomplete="off" spellcheck="false" />
    </div>
    <div id="sb-tree" class="sb-tree" tabindex="0"></div>
    <div class="sb-divider" id="sb-divider"></div>
    <div id="sb-detail" class="sb-detail" style="display:none"></div>
    <div class="sb-shortcut-hint">Shift+Tab to toggle</div>
  `;

  const treeEl = document.getElementById('sb-tree');
  const detailEl = document.getElementById('sb-detail');
  const searchInput = document.getElementById('sidebar-search');

  // Build nested folder tree
  const navItems = [];
  const folderTree = tesseract.getFolderTree();

  // Count all nodes under a tree node (recursive)
  function countNodes(treeNode) {
    let c = treeNode.nodes.length;
    for (const child of treeNode.children.values()) c += countNodes(child);
    return c;
  }

  // Recursively build DOM from tree, with depth for indentation
  function buildTreeLevel(treeNode, container, depth) {
    // Sort children: FOLDER_ORDER first, then alphabetical
    const childKeys = [...treeNode.children.keys()].sort((a, b) => {
      const ai = FOLDER_ORDER.indexOf(a);
      const bi = FOLDER_ORDER.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    });

    for (const key of childKeys) {
      const child = treeNode.children.get(key);
      const total = countNodes(child);
      if (total === 0) continue;

      const details = document.createElement('details');
      details.className = 'sb-folder';
      details.open = false;

      const summary = document.createElement('summary');
      summary.className = 'sb-folder-header';
      summary.style.paddingLeft = (12 + depth * 10) + 'px';
      summary.innerHTML = `<span class="sb-folder-name">${cleanFolderName(key)}</span><span class="sb-folder-count">${total}</span>`;
      summary.addEventListener('click', (e) => {
        e.preventDefault();
        details.open = !details.open;
        rebuildNavItems();
      });
      details.appendChild(summary);

      navItems.push({ type: 'folder', el: summary, folder: key, detailsEl: details });

      const list = document.createElement('div');
      list.className = 'sb-folder-list';

      // Nodes at this level
      for (const node of child.nodes) {
        const item = document.createElement('div');
        item.className = 'sb-node';
        item.dataset.nodeId = node.id;
        item.style.paddingLeft = (22 + depth * 10) + 'px';
        item.innerHTML = `<span class="sb-node-title">${node.title || node.id}</span>${node.linkCount > 0 ? `<span class="sb-node-links">${node.linkCount}</span>` : ''}`;
        item.addEventListener('click', () => {
          focusIndex = visibleItems.indexOf(visibleItems.find(v => v.nodeId === node.id));
          onSelect(node.id);
          if (readerPanel.classList.contains('open')) openInlineReader(node.id);
        });
        item.addEventListener('dblclick', () => {
          openInlineReader(node.id);
        });
        list.appendChild(item);
      }

      details.appendChild(list);

      // Recurse into subfolders
      buildTreeLevel(child, list, depth + 1);

      container.appendChild(details);
    }
  }

  buildTreeLevel(folderTree, treeEl, 0);

  // Visible items (respects open/closed folders)
  let visibleItems = [];
  let focusIndex = -1;

  function rebuildNavItems() {
    visibleItems = [];
    // Walk the DOM tree to find visible items (respects nested open/closed)
    function walkEl(container) {
      for (const child of container.children) {
        if (child.classList.contains('sb-folder')) {
          const summary = child.querySelector(':scope > summary');
          const navItem = navItems.find(n => n.el === summary);
          if (navItem) visibleItems.push(navItem);
          if (child.open) {
            walkEl(child); // recurse into open folder
          }
        } else if (child.classList.contains('sb-folder-list')) {
          walkEl(child);
        } else if (child.classList.contains('sb-node')) {
          visibleItems.push({
            type: 'node',
            el: child,
            nodeId: child.dataset.nodeId,
          });
        }
      }
    }
    walkEl(treeEl);
  }
  rebuildNavItems();

  function setFocus(idx) {
    if (idx < 0 || idx >= visibleItems.length) return;

    // Remove old focus
    treeEl.querySelectorAll('.sb-focused').forEach(el => el.classList.remove('sb-focused'));

    focusIndex = idx;
    const item = visibleItems[idx];
    item.el?.classList.add('sb-focused');
    item.el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    // If it's a node, select in graph. Update reader only if already open.
    if (item.type === 'node' && item.nodeId) {
      onSelect(item.nodeId);
      if (readerPanel.classList.contains('open')) openInlineReader(item.nodeId);
    }
  }

  // Keyboard navigation
  treeEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocus(Math.min(focusIndex + 1, visibleItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocus(Math.max(focusIndex - 1, 0));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const item = visibleItems[focusIndex];
      if (item?.type === 'folder' && !item.detailsEl.open) {
        item.detailsEl.open = true;
        rebuildNavItems();
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const item = visibleItems[focusIndex];
      if (item?.type === 'folder' && item.detailsEl.open) {
        item.detailsEl.open = false;
        rebuildNavItems();
      } else if (item?.type === 'node') {
        // Jump to parent folder
        const parentIdx = visibleItems.findIndex(v => v.type === 'folder' && v.folder === item.folder);
        if (parentIdx >= 0) setFocus(parentIdx);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = visibleItems[focusIndex];
      if (item?.type === 'folder') {
        item.detailsEl.open = !item.detailsEl.open;
        rebuildNavItems();
      } else if (item?.type === 'node') {
        openInlineReader(item.nodeId);
      }
    }
  });

  // Focus tree on click
  treeEl.addEventListener('click', () => treeEl.focus());

  // Resizable divider between tree and detail
  const divider = document.getElementById('sb-divider');
  let isDragging = false;

  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const sidebarRect = sidebar.getBoundingClientRect();
    const y = e.clientY - sidebarRect.top;
    const totalHeight = sidebarRect.height - 80; // account for search + hint
    const treeHeight = Math.max(80, Math.min(y - 50, totalHeight - 80));
    treeEl.style.maxHeight = treeHeight + 'px';
    treeEl.style.minHeight = treeHeight + 'px';
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });

  // Double-click divider: toggle detail panel
  divider.addEventListener('dblclick', () => {
    if (detailEl.style.display === 'none') {
      detailEl.style.display = 'block';
    } else {
      detailEl.style.display = 'none';
    }
  });

  // ============ READER PANEL (adjacent panel) ============
  const readerPanel = document.getElementById('reader-panel');
  const readerResize = document.getElementById('reader-resize');

  // Track stacked columns
  let readerColumns = [];

  function openInlineReader(nodeId, append = false) {
    const node = tesseract.getNode(nodeId);
    if (!node) return;

    const content = node.content || 'No content available.';

    if (!append) {
      // Replace: clear all columns, show single doc
      readerColumns = [nodeId];
      readerPanel.innerHTML = `
        <div id="reader-resize"></div>
        <div class="rp-panel-bar">
          <button class="rp-close-all" title="Close reader">&times;</button>
        </div>
        <div class="rp-stack"></div>
      `;
      readerPanel.querySelector('.rp-close-all').addEventListener('click', closeInlineReader);
    }

    // If appending (wikilink click), add to stack
    if (append && !readerColumns.includes(nodeId)) {
      readerColumns.push(nodeId);
    }

    // Rebuild all columns
    const stack = readerPanel.querySelector('.rp-stack') || readerPanel;
    if (readerPanel.querySelector('.rp-stack')) {
      stack.innerHTML = '';
    }

    for (const colId of readerColumns) {
      const colNode = tesseract.getNode(colId);
      if (!colNode) continue;
      const colContent = colNode.content || 'No content available.';

      const col = document.createElement('div');
      col.className = 'rp-column';
      col.innerHTML = `
        <div class="rp-header">
          <div class="rp-title">${escapeHtml(colNode.title || colNode.id)}</div>
          <button class="rp-col-close" data-col-id="${colId}">&times;</button>
        </div>
        <div class="rp-meta">
          <span class="rp-badge">${cleanFolderName(colNode.folder)}</span>
          ${colNode.type && colNode.type !== 'unknown' ? `<span class="rp-badge">${colNode.type}</span>` : ''}
          <span class="rp-badge">${colNode.linkCount || 0} links</span>
        </div>
        <div class="rp-body">${formatMarkdown(colContent)}</div>
        <div class="rp-footer">
          <a class="rp-obsidian" href="obsidian://open?vault=The-Hive&file=${encodeURIComponent((colNode.path || '').replace('.md', ''))}">
            Open in Obsidian
          </a>
        </div>
      `;
      stack.appendChild(col);

      // Close individual column
      col.querySelector('.rp-col-close').addEventListener('click', () => {
        readerColumns = readerColumns.filter(id => id !== colId);
        if (readerColumns.length === 0) {
          closeInlineReader();
        } else {
          openInlineReader(readerColumns[0], false);
          // Re-add remaining columns
          for (let i = 1; i < readerColumns.length; i++) {
            // This is handled by the rebuild above
          }
          // Actually just rebuild
          const saved = [...readerColumns];
          readerColumns = [saved[0]];
          openInlineReader(saved[0], false);
          for (let i = 1; i < saved.length; i++) {
            readerColumns.push(saved[i]);
          }
          // Re-render stack
          rebuildStack();
        }
      });

      // Make wikilinks clickable: [[link text]] -> find node, open stacked
      col.querySelectorAll('.sb-md-link').forEach(link => {
        link.style.cursor = 'pointer';
        link.addEventListener('click', () => {
          const linkText = link.textContent.trim();
          // Search for the linked node by id or title
          const linkedNode = tesseract.nodes.find(n =>
            n.id === linkText || (n.title || '').toLowerCase() === linkText.toLowerCase()
          );
          if (linkedNode) {
            openInlineReader(linkedNode.id, true);
            onSelect(linkedNode.id);
          }
        });
      });
    }

    const panelWidth = Math.min(readerColumns.length * 550, window.innerWidth - 500);
    readerPanel.style.width = panelWidth + 'px';
    readerPanel.classList.add('open');

    setupReaderResize();
    window.dispatchEvent(new Event('resize'));
  }

  function rebuildStack() {
    const saved = [...readerColumns];
    readerColumns = [];
    readerPanel.innerHTML = `<div id="reader-resize"></div><div class="rp-stack"></div>`;
    for (const id of saved) {
      readerColumns.push(id);
    }
    openInlineReader(saved[0], false);
    // Re-add extras
    for (let i = 1; i < saved.length; i++) {
      if (!readerColumns.includes(saved[i])) readerColumns.push(saved[i]);
    }
    // Force re-render
    openInlineReader(readerColumns[0], false);
  }

  function closeInlineReader() {
    readerColumns = [];
    readerPanel.classList.remove('open');
    readerPanel.style.width = '0';
    readerPanel.innerHTML = '<div id="reader-resize"></div>';
    window.dispatchEvent(new Event('resize'));
  }

  function setupReaderResize() {
    const handle = readerPanel.querySelector('#reader-resize');
    if (!handle) return;
    let resizing = false;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      resizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const sidebarW = document.getElementById('sidebar').offsetWidth;
      const newW = Math.max(250, Math.min(e.clientX - sidebarW, window.innerWidth - sidebarW - 200));
      readerPanel.style.width = newW + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (resizing) {
        resizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.dispatchEvent(new Event('resize'));
      }
    });
  }

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatMarkdown(text) {
    return text.split('\n').map(line => {
      if (line.match(/^#{1,6}\s/)) {
        const level = line.match(/^(#+)/)[1].length;
        return `<div class="sb-md-h sb-md-h${level}">${escapeHtml(line.replace(/^#+\s*/, ''))}</div>`;
      }
      if (line.startsWith('```')) return '<hr class="sb-md-sep">';
      if (line.match(/^[-*]\s/)) return `<div class="sb-md-li">${formatInline(escapeHtml(line.replace(/^[-*]\s/, '')))}</div>`;
      if (line.trim() === '') return '<br>';
      return `<div class="sb-md-p">${formatInline(escapeHtml(line))}</div>`;
    }).join('');
  }

  function formatInline(text) {
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/`(.+?)`/g, '<code class="sb-md-code">$1</code>');
    text = text.replace(/\[\[([^\]]+?)\]\]/g, '<span class="sb-md-link">$1</span>');
    return text;
  }

  // Search
  let searchMode = false;
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    if (q.length < 2) { exitSearchMode(); return; }
    enterSearchMode(q);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = searchInput.value.trim();
      if (q.length >= 2) {
        const hits = tesseract.search(q);
        if (hits.length > 0) onSelect(hits[0].id);
      }
    }
    if (e.key === 'Escape') {
      searchInput.value = '';
      exitSearchMode();
      searchInput.blur();
    }
    // ArrowDown from search focuses the tree
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      treeEl.focus();
      if (focusIndex < 0) setFocus(0);
    }
  });

  function enterSearchMode(query) {
    searchMode = true;
    const hits = tesseract.search(query).slice(0, 20);
    // Highlight matches in 3D
    if (onSearchHighlight) {
      onSearchHighlight(new Set(hits.map(h => h.id)));
    }
    treeEl.style.display = 'none';
    detailEl.style.display = 'block';
    detailEl.innerHTML = hits.map(h => `
      <div class="sb-node sb-search-result" data-node-id="${h.id}">
        <span class="sb-node-title">${h.title || h.id}</span>
        <span class="sb-node-folder">${cleanFolderName(h.folder)}</span>
      </div>
    `).join('');
    detailEl.querySelectorAll('.sb-search-result').forEach(el => {
      el.addEventListener('click', () => onSelect(el.dataset.nodeId));
    });
  }

  function exitSearchMode() {
    searchMode = false;
    treeEl.style.display = 'block';
    detailEl.style.display = 'none';
    detailEl.innerHTML = '';
    // Clear 3D highlights
    if (onSearchHighlight) onSearchHighlight(null);
  }

  // Show detail when a node is selected (from graph click or sidebar)
  function showNodeDetail(nodeId) {
    if (!nodeId) {
      if (!searchMode) { detailEl.style.display = 'none'; treeEl.style.display = 'block'; }
      sidebar.querySelectorAll('.sb-node.active').forEach(el => el.classList.remove('active'));
      return;
    }

    const node = tesseract.getNode(nodeId);
    if (!node) return;

    // Highlight in tree
    sidebar.querySelectorAll('.sb-node.active').forEach(el => el.classList.remove('active'));
    const nodeEl = sidebar.querySelector(`.sb-node[data-node-id="${CSS.escape(nodeId)}"]`);
    if (nodeEl) {
      nodeEl.classList.add('active');
      const folder = nodeEl.closest('.sb-folder');
      if (folder) folder.open = true;
      rebuildNavItems();
      nodeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // Show detail panel
    const neighbors = tesseract.getNeighbors(nodeId);
    const tags = (node.tags || []).map(t => `<span class="sb-tag">#${t}</span>`).join('');

    if (!searchMode) {
      detailEl.style.display = 'block';
      detailEl.innerHTML = `
        <div class="sb-detail-header">
          <div class="sb-detail-title">${node.title || node.id}</div>
          <div class="sb-detail-path">${node.path}</div>
        </div>
        <div class="sb-detail-meta">
          ${node.type ? `<span class="sb-badge">${node.type}</span>` : ''}
          <span class="sb-badge">${cleanFolderName(node.folder)}</span>
          <span class="sb-badge">${node.linkCount || 0} links</span>
        </div>
        ${tags ? `<div class="sb-detail-tags">${tags}</div>` : ''}
        ${neighbors.length > 0 ? `
          <div class="sb-detail-section">
            <div class="sb-detail-label">Connected</div>
            ${neighbors.slice(0, 20).map(n => `
              <div class="sb-node sb-neighbor" data-node-id="${n.id}">
                <span class="sb-node-title">${n.title || n.id}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
        <button class="sb-read-btn" data-node-id="${nodeId}">Read Document</button>
        <a class="sb-obsidian-link" href="obsidian://open?vault=The-Hive&file=${encodeURIComponent((node.path || '').replace('.md', ''))}">
          Open in Obsidian
        </a>
      `;

      detailEl.querySelectorAll('.sb-neighbor').forEach(el => {
        el.addEventListener('click', () => {
          onSelect(el.dataset.nodeId);
          if (readerPanel.classList.contains('open')) openInlineReader(el.dataset.nodeId);
        });
      });

      const readBtn = detailEl.querySelector('.sb-read-btn');
      if (readBtn) {
        readBtn.addEventListener('click', () => openInlineReader(readBtn.dataset.nodeId));
      }
    }
  }

  onSelectCallbacks.push((nodeId) => {
    showNodeDetail(nodeId);
    if (nodeId && readerPanel.classList.contains('open')) openInlineReader(nodeId);
  });

  return {
    openInlineReader,
    closeInlineReader,
    isInlineReaderOpen: () => readerPanel.classList.contains('open'),
  };
}
