// Search + Filter panel
export function createSearchPanel(graph, onFilterChange) {
  const folders = [...new Set(graph.nodes.map(n => n.folder))].sort();
  const types = [...new Set(graph.nodes.map(n => n.type))].sort();
  const activeFilters = { search: '', folders: new Set(folders), type: '' };

  const panel = document.createElement('div');
  panel.id = 'search-panel';
  panel.style.cssText = 'position:fixed;top:12px;left:12px;width:220px;background:rgba(5,5,16,0.88);border:1px solid rgba(155,77,255,0.2);border-radius:8px;padding:14px;z-index:100;font-family:system-ui;color:#e2e8f0;font-size:12px;max-height:80vh;overflow-y:auto;';

  // Search box
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search nodes...';
  searchInput.style.cssText = 'width:100%;padding:6px 10px;background:rgba(255,255,255,0.05);border:1px solid rgba(155,77,255,0.2);border-radius:4px;color:#e2e8f0;font-size:12px;outline:none;margin-bottom:10px;box-sizing:border-box;';

  panel.appendChild(searchInput);

  // Folder color map for dots
  const folderColors = {
    '10-Sessions':'#1a6bff','20-Architecture':'#9b4dff','30-Projects':'#ffaa00',
    '50-Playbooks':'#00e6b0','60-Knowledge':'#00ff66','70-Ops':'#ff3366',
    '01-Daily':'#00ccff','40-Decisions':'#9b4dff','80-Secure':'#ff3366',
  };

  // Folder toggles
  const folderDiv = document.createElement('div');
  folderDiv.innerHTML = '<div style="color:#888;margin-bottom:6px;font-size:11px">Folders</div>';
  folders.forEach(f => {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.style.cssText = 'accent-color:' + (folderColors[f] || '#888');
    const dot = document.createElement('span');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${folderColors[f]||'#888'};display:inline-block;`;
    const label = document.createElement('span');
    label.textContent = f;
    label.style.cssText = 'color:#aaa;font-size:11px;';

    cb.addEventListener('change', () => {
      if (cb.checked) activeFilters.folders.add(f);
      else activeFilters.folders.delete(f);
      emitFilter();
    });
    row.appendChild(cb); row.appendChild(dot); row.appendChild(label);
    folderDiv.appendChild(row);
  });
  panel.appendChild(folderDiv);

  // Type filter
  const typeDiv = document.createElement('div');
  typeDiv.style.cssText = 'margin-top:10px;';
  typeDiv.innerHTML = '<div style="color:#888;margin-bottom:4px;font-size:11px">Type</div>';
  const typeSelect = document.createElement('select');
  typeSelect.style.cssText = 'width:100%;padding:4px;background:rgba(255,255,255,0.05);border:1px solid rgba(155,77,255,0.2);border-radius:4px;color:#e2e8f0;font-size:11px;';
  typeSelect.innerHTML = '<option value="">All types</option>' + types.map(t => `<option value="${t}">${t}</option>`).join('');
  typeSelect.addEventListener('change', () => {
    activeFilters.type = typeSelect.value;
    emitFilter();
  });
  typeDiv.appendChild(typeSelect);
  panel.appendChild(typeDiv);

  // Count display
  const countDiv = document.createElement('div');
  countDiv.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px solid rgba(155,77,255,0.15);color:#666;font-size:11px;';
  panel.appendChild(countDiv);

  // Clear button
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear filters';
  clearBtn.style.cssText = 'margin-top:8px;width:100%;padding:4px;background:rgba(155,77,255,0.1);border:1px solid rgba(155,77,255,0.2);border-radius:4px;color:#888;font-size:11px;cursor:pointer;';
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    activeFilters.search = '';
    activeFilters.type = '';
    typeSelect.value = '';
    folders.forEach(f => activeFilters.folders.add(f));
    folderDiv.querySelectorAll('input').forEach(cb => cb.checked = true);
    emitFilter();
  });
  panel.appendChild(clearBtn);

  searchInput.addEventListener('input', () => {
    activeFilters.search = searchInput.value.toLowerCase();
    emitFilter();
  });

  // / key focuses search
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && e.target === document.body) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  function emitFilter() {
    const matching = graph.nodes.filter(n => nodeMatchesFilter(n));
    countDiv.textContent = `${matching.length} / ${graph.nodes.length} visible`;
    onFilterChange(activeFilters);
  }

  function nodeMatchesFilter(n) {
    if (!activeFilters.folders.has(n.folder)) return false;
    if (activeFilters.type && n.type !== activeFilters.type) return false;
    if (activeFilters.search) {
      const s = activeFilters.search;
      return n.id.toLowerCase().includes(s) || n.title.toLowerCase().includes(s) ||
        n.tags.some(t => t.toLowerCase().includes(s)) || n.type.toLowerCase().includes(s);
    }
    return true;
  }

  document.body.appendChild(panel);
  emitFilter();
  return { panel, getFilters: () => activeFilters, nodeMatchesFilter };
}
