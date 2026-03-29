function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatScore(score) {
  const value = Number(score);
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function renderCandidateContext(candidate) {
  const details = [candidate.dateLabel, candidate.folder].filter(Boolean);
  if (details.length === 0) return '';
  return `<div class="orb-candidate-context">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join('')}</div>`;
}

function renderCandidateHints(candidateHints) {
  if (!Array.isArray(candidateHints) || candidateHints.length === 0) return '';

  return `
    <div class="orb-hints">
      ${candidateHints.map((candidate) => `
        <div class="orb-hint">
          <div class="orb-hint-title">${escapeHtml(candidate.title || '')}</div>
          ${candidate.reason ? `<div class="orb-hint-reason">${escapeHtml(candidate.reason)}</div>` : ''}
          ${candidate.path ? `<div class="orb-hint-path">${escapeHtml(candidate.path)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderVergilIdentity() {
  return `
    <div class="orb-identity-rail" aria-label="Vergil command identity">
      <div class="orb-identity-frame">
        <div class="orb-identity-copy">
          <div class="orb-identity-title-row">
            <div class="orb-identity-name">Vergil</div>
            <div class="orb-identity-sigil">VN-01</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderVergilTelemetry() {
  return `
    <div class="orb-telemetry-rail" aria-label="Vergil signal telemetry">
      <div class="orb-telemetry-item">
        <span class="orb-telemetry-label">Signal</span>
        <span class="orb-telemetry-value">Live</span>
      </div>
    </div>
  `;
}

function buildNarration(state) {
  switch (state.mode) {
    case 'searching':
      return {
        text: 'Triangulating now.',
        ttlMs: 1800,
      };
    case 'armed': {
      const selection = state.armedSelection || state.resolved;
      if (!selection) return null;
      return {
        text: `Target lock on ${selection.title || 'the note'}.`,
        ttlMs: 2600,
      };
    }
    case 'candidates': {
      if (!Array.isArray(state.candidates) || state.candidates.length === 0) return null;
      return {
        text: `I have ${state.candidates.length} plausible locks. Choose the right one.`,
        ttlMs: 3200,
      };
    }
    case 'clarification':
      return state.question ? { text: state.question, ttlMs: 3600 } : null;
    case 'error':
      return state.message ? { text: state.message, ttlMs: 3600 } : null;
    default:
      return null;
  }
}

function compactPromptForMode(mode) {
  switch (mode) {
    case 'clarification':
      return 'Clarify the lock...';
    case 'searching':
      return 'Retrieving...';
    default:
      return 'Retrieve a note, scene, or idea.';
  }
}

const FOLLOW_MODES = [
  { value: 'off', label: 'Off', description: 'Manual orbit only' },
  { value: 'fov', label: 'FOV', description: 'Committed chase view' },
  { value: 'close', label: 'Close', description: 'Tight escort framing' },
  { value: 'medium', label: 'Medium', description: 'Balanced pursuit' },
  { value: 'far', label: 'Far', description: 'Wide tracking view' },
];

const LAYOUT_PRESETS = [
  { value: 'cluster', label: 'Cluster' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'halo_ring', label: 'Halo Ring' },
  { value: 'helix', label: 'Helix' },
  { value: 'dna', label: 'DNA' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'pyramid', label: 'Pyramid' },
  { value: 'crown', label: 'Crown' },
  { value: 'sacred', label: 'Sacred' },
  { value: 'temporal_spiral', label: 'Temporal Spiral' },
];

function findFollowMode(value) {
  return FOLLOW_MODES.find((mode) => mode.value === value) || FOLLOW_MODES[0];
}

function findLayoutPreset(value) {
  return LAYOUT_PRESETS.find((preset) => preset.value === value) || LAYOUT_PRESETS[0];
}

function renderFollowMenu(state) {
  return `
    <div class="orb-popover orb-follow-menu${state.controls.followMenuOpen ? ' orb-popover-open' : ''}" data-menu="follow">
      <div class="orb-popover-label">Follow</div>
      <div class="orb-menu-grid">
        ${FOLLOW_MODES.map((mode) => `
          <button
            class="orb-menu-option${state.controls.followMode === mode.value ? ' orb-menu-option-active' : ''}"
            type="button"
            data-follow-mode="${mode.value}"
          >
            <span class="orb-menu-option-title">${mode.label}</span>
            <span class="orb-menu-option-copy">${mode.description}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderLayoutMenu(state) {
  const construction = state.controls.constructionMode;
  return `
    <div class="orb-popover orb-layout-menu${state.controls.layoutMenuOpen ? ' orb-popover-open' : ''}" data-menu="layout">
      <div class="orb-popover-section">
        <div class="orb-popover-label">Layout presets</div>
        <div class="orb-menu-grid orb-menu-grid-layout">
          ${LAYOUT_PRESETS.map((preset) => `
            <button
              class="orb-menu-option${state.controls.activeLayoutPreset === preset.value ? ' orb-menu-option-active' : ''}"
              type="button"
              data-layout-preset="${preset.value}"
            >
              <span class="orb-menu-option-title">${preset.label}</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="orb-popover-section orb-popover-section-divider">
        <div class="orb-popover-label">Construction mode</div>
        <div class="orb-construction-copy">
          ${construction.active
            ? `Tracing lattice ${Math.round((construction.progress || 0) * 100)}%`
            : 'Manual spectacle mode. Vergil traces the graph into existence.'}
        </div>
        ${construction.active ? `
          <div class="orb-progress">
            <div class="orb-progress-bar" style="width:${Math.round((construction.progress || 0) * 100)}%"></div>
          </div>
        ` : ''}
        <button
          class="orb-menu-option orb-menu-option-wide${construction.active ? ' orb-menu-option-active' : ''}"
          type="button"
          data-construction-action="${construction.active ? 'stop' : 'start'}"
        >
          <span class="orb-menu-option-title">${construction.active ? 'Stop construction' : 'Start construction'}</span>
          <span class="orb-menu-option-copy">${construction.active ? 'Return to standard navigation' : 'Manual showcase mode'}</span>
        </button>
      </div>
    </div>
  `;
}

function normalizeControls(controls = {}) {
  const previousFollowMode = typeof controls.followMode === 'string' ? controls.followMode.toLowerCase() : null;
  const derivedFollowMode = previousFollowMode
    || (controls.follow ? 'medium' : 'off');
  const normalizedConstruction = typeof controls.constructionMode === 'object' && controls.constructionMode
    ? controls.constructionMode
    : { active: Boolean(controls.constructionMode) };
  return {
    commandMode: Boolean(controls.commandMode),
    follow: derivedFollowMode !== 'off',
    followMode: findFollowMode(derivedFollowMode).value,
    followMenuOpen: Boolean(controls.followMenuOpen),
    rotate: Boolean(controls.rotate),
    shuffle: Boolean(controls.shuffle),
    layoutMenuOpen: Boolean(controls.layoutMenuOpen),
    activeLayoutPreset: findLayoutPreset(controls.activeLayoutPreset || controls.layoutPreset || 'cluster').value,
    constructionMode: {
      active: Boolean(normalizedConstruction.active),
      progress: Number.isFinite(normalizedConstruction.progress) ? normalizedConstruction.progress : 0,
      durationMs: Number.isFinite(normalizedConstruction.durationMs) ? normalizedConstruction.durationMs : 0,
      status: normalizedConstruction.status || (normalizedConstruction.active ? 'constructing' : 'idle'),
    },
  };
}

function formatVergilState(value) {
  const normalized = String(value || 'ambient').replace(/[_-]+/g, ' ').trim();
  if (!normalized) return 'Ambient';
  return normalized.toUpperCase();
}

function renderControlButton(label, key, active) {
  return `
    <button
      class="orb-control${active ? ' orb-control-active' : ''}"
      type="button"
      data-control="${key}"
      aria-pressed="${active ? 'true' : 'false'}"
    >
      ${label}
    </button>
  `;
}

function renderMenuButton(label, key, active, detail) {
  return `
    <button
      class="orb-control orb-control-menu${active ? ' orb-control-active' : ''}"
      type="button"
      data-control="${key}"
      aria-expanded="${active ? 'true' : 'false'}"
    >
      <span>${label}</span>
      ${detail ? `<span class="orb-control-detail">${escapeHtml(detail)}</span>` : ''}
    </button>
  `;
}

function renderArmedSelection(selection) {
  if (!selection) return '';

  return `
    <div class="orb-card orb-card-armed">
      <div class="orb-card-label">Armed selection</div>
      <div class="orb-card-title">${escapeHtml(selection.title || '')}</div>
      ${renderCandidateContext(selection)}
      <div class="orb-card-meta">
        <span>${escapeHtml(selection.path || selection.folder || '')}</span>
        <span>${formatScore(selection.score)}</span>
      </div>
      ${selection.excerpt ? `<div class="orb-candidate-excerpt">${escapeHtml(selection.excerpt)}</div>` : ''}
      ${selection.reason ? `<div class="orb-candidate-reason">${escapeHtml(selection.reason)}</div>` : ''}
      <div class="orb-armed-copy">Target acquired. Activate when ready.</div>
      <div class="orb-action-row">
        <button class="orb-action orb-action-primary" type="button" data-action="activate">Activate</button>
        <button class="orb-action orb-action-secondary" type="button" data-action="dismiss">Dismiss</button>
      </div>
    </div>
  `;
}

function renderBody(state) {
  if (state.controls?.constructionMode?.active && state.mode === 'idle') {
    return `
      <div class="orb-status orb-status-construction">
        <div class="orb-section-label">Construction mode</div>
        <div class="orb-question">Vergil is tracing the lattice into being.</div>
        <div class="orb-progress">
          <div class="orb-progress-bar" style="width:${Math.round((state.controls.constructionMode.progress || 0) * 100)}%"></div>
        </div>
      </div>
    `;
  }
  switch (state.mode) {
    case 'searching':
      return `
        <div class="orb-status orb-status-searching">
          <span class="orb-spinner" aria-hidden="true"></span>
          <span>Reading the field</span>
        </div>
      `;
    case 'armed':
      return `
        ${renderArmedSelection(state.armedSelection || state.resolved)}
      `;
    case 'candidates':
      return `
        <div class="orb-section-label">Possible locks</div>
        ${renderArmedSelection(state.armedSelection)}
        <div class="orb-candidates">
          ${state.candidates.map((candidate, index) => `
            <button class="orb-candidate${state.armedSelection?.nodeId === candidate.nodeId ? ' orb-candidate-armed' : ''}" type="button" data-candidate-index="${index}">
              <div class="orb-candidate-title">${escapeHtml(candidate.title || '')}</div>
              ${renderCandidateContext(candidate)}
              <div class="orb-candidate-meta">
                <span>${escapeHtml(candidate.path || '')}</span>
                <span>${formatScore(candidate.score)}</span>
              </div>
              ${candidate.excerpt ? `<div class="orb-candidate-excerpt">${escapeHtml(candidate.excerpt)}</div>` : ''}
              ${candidate.reason ? `<div class="orb-candidate-reason">${escapeHtml(candidate.reason)}</div>` : ''}
            </button>
          `).join('')}
        </div>
      `;
    case 'clarification':
      return `
        <div class="orb-status orb-status-question">
          <div class="orb-section-label">Need a cleaner signal</div>
          <div class="orb-question">${escapeHtml(state.question)}</div>
          ${renderCandidateHints(state.candidateHints)}
        </div>
      `;
    case 'error':
      return `
        <div class="orb-status orb-status-error">
          <div class="orb-section-label">Sensor ghost</div>
          <div class="orb-error-message">${escapeHtml(state.message)}</div>
        </div>
      `;
    case 'idle':
    default:
      return '';
  }
}

export function createOrb({
  mount,
  onSubmit,
  onCandidateSelect,
  onActivateSelection,
  onDismissSelection,
  onControlToggle,
  onNarration,
  onFocusChange,
  onInputActivity,
}) {
  mount.innerHTML = `
    <div class="orb-shell">
      <div class="orb-panel">
        <div class="orb-command-row">
          <div class="orb-side orb-side-left">
            ${renderVergilIdentity()}
            ${renderVergilTelemetry()}
          </div>
          <form class="orb-form">
            <span class="orb-form-label">Retrieve</span>
            <input class="orb-input" type="text" autocomplete="off" spellcheck="false" placeholder="Retrieve a note, scene, or idea." />
            <button class="orb-submit" type="submit">Go</button>
          </form>
          <div class="orb-side orb-side-right">
            <div class="orb-cluster orb-cluster-left">
              ${renderControlButton('CMD', 'commandMode', false)}
              <div class="orb-menu-anchor">
                ${renderMenuButton('FOLLOW', 'followMenu', false, findFollowMode('off').label)}
                ${renderFollowMenu({
                  controls: normalizeControls(),
                })}
              </div>
              ${renderControlButton('ROTATE', 'rotate', false)}
              <div class="orb-menu-anchor">
                ${renderMenuButton('LAYOUT', 'layoutMenu', false, findLayoutPreset('cluster').label)}
                ${renderLayoutMenu({
                  controls: normalizeControls(),
                })}
              </div>
            </div>
            <div class="orb-state-chip">
              <span class="orb-state-chip-label">State</span>
              <span class="orb-state-chip-value orb-vergil-state">Ambient</span>
            </div>
          </div>
        </div>
        <div class="orb-body"></div>
      </div>
    </div>
  `;

  const shell = mount.querySelector('.orb-shell');
  const panel = mount.querySelector('.orb-panel');
  const form = mount.querySelector('.orb-form');
  const input = mount.querySelector('.orb-input');
  const body = mount.querySelector('.orb-body');
  const submit = mount.querySelector('.orb-submit');
  const controlsHost = mount.querySelector('.orb-cluster-left');
  const stateBadge = mount.querySelector('.orb-vergil-state');
  const stateChipValue = mount.querySelector('.orb-state-chip-value');
  let redirectedPopoverTarget = null;
  const state = {
    mode: 'idle',
    candidates: [],
    candidateHints: [],
    question: '',
    message: '',
    resolved: null,
    armedSelection: null,
    controls: normalizeControls(),
    vergilState: 'ambient',
  };

  function syncControls() {
    controlsHost?.querySelectorAll('[data-control]').forEach((button) => {
      const key = button.dataset.control;
      let active = Boolean(state.controls[key]);
      if (key === 'followMenu') active = state.controls.followMenuOpen || state.controls.followMode !== 'off';
      if (key === 'layoutMenu') active = state.controls.layoutMenuOpen;
      button.classList.toggle('orb-control-active', active);
      if (key === 'followMenu' || key === 'layoutMenu') {
        button.setAttribute('aria-expanded', state.controls[key === 'followMenu' ? 'followMenuOpen' : 'layoutMenuOpen'] ? 'true' : 'false');
      } else {
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
      if (key === 'followMenu') {
        const detail = button.querySelector('.orb-control-detail');
        if (detail) detail.textContent = findFollowMode(state.controls.followMode).label;
      }
      if (key === 'layoutMenu') {
        const detail = button.querySelector('.orb-control-detail');
        if (detail) detail.textContent = findLayoutPreset(state.controls.activeLayoutPreset).label;
      }
    });
    mount.querySelectorAll('[data-follow-mode]').forEach((button) => {
      button.classList.toggle('orb-menu-option-active', button.dataset.followMode === state.controls.followMode);
    });
    mount.querySelectorAll('[data-layout-preset]').forEach((button) => {
      button.classList.toggle('orb-menu-option-active', button.dataset.layoutPreset === state.controls.activeLayoutPreset);
    });
    mount.querySelector('[data-menu="follow"]')?.classList.toggle('orb-popover-open', state.controls.followMenuOpen);
    const layoutMenu = mount.querySelector('[data-menu="layout"]');
    layoutMenu?.classList.toggle('orb-popover-open', state.controls.layoutMenuOpen);

    if (layoutMenu) {
      const constructionActive = Boolean(state.controls.constructionMode?.active);
      const constructionProgress = Math.round((state.controls.constructionMode?.progress || 0) * 100);
      const constructionCopy = layoutMenu.querySelector('.orb-construction-copy');
      if (constructionCopy) {
        constructionCopy.textContent = constructionActive
          ? `Tracing lattice ${constructionProgress}%`
          : 'Manual spectacle mode. Vergil traces the graph into existence.';
      }

      let progress = layoutMenu.querySelector('.orb-progress');
      if (constructionActive) {
        if (!progress) {
          progress = document.createElement('div');
          progress.className = 'orb-progress';
          progress.innerHTML = '<div class="orb-progress-bar"></div>';
          constructionCopy?.insertAdjacentElement('afterend', progress);
        }
        const progressBar = progress.querySelector('.orb-progress-bar');
        if (progressBar) {
          progressBar.style.width = `${constructionProgress}%`;
        }
      } else if (progress) {
        progress.remove();
      }

      const constructionAction = layoutMenu.querySelector('[data-construction-action]');
      if (constructionAction) {
        constructionAction.dataset.constructionAction = constructionActive ? 'stop' : 'start';
        constructionAction.classList.toggle('orb-menu-option-active', constructionActive);
        const title = constructionAction.querySelector('.orb-menu-option-title');
        const copy = constructionAction.querySelector('.orb-menu-option-copy');
        if (title) {
          title.textContent = constructionActive ? 'Stop construction' : 'Start construction';
        }
        if (copy) {
          copy.textContent = constructionActive ? 'Return to standard navigation' : 'Manual showcase mode';
        }
      }
    }
  }

  function syncVergilState() {
    const label = formatVergilState(state.vergilState);
    if (stateBadge) stateBadge.textContent = label;
    if (stateChipValue) stateChipValue.textContent = label;
  }

  function setFocusState(focused) {
    shell?.classList.toggle('orb-shell-focused', focused);
    panel?.setAttribute('data-focus', focused ? 'active' : 'idle');
    onFocusChange?.(focused);
    onInputActivity?.({
      focused,
      active: focused || input.value.trim().length > 0,
      value: input.value,
    });
  }

  function emitNarration(nextState) {
    const narration = nextState.narration || buildNarration(nextState);
    if (narration) onNarration?.(narration);
  }

  function applyState(nextState) {
    state.mode = nextState.mode ?? state.mode ?? 'idle';
    state.candidates = nextState.candidates ?? state.candidates ?? [];
    state.candidateHints = nextState.candidateHints ?? state.candidateHints ?? [];
    state.question = nextState.question ?? state.question ?? '';
    state.message = nextState.message ?? state.message ?? '';
    state.resolved = nextState.resolved ?? state.resolved ?? null;
    state.armedSelection = nextState.armedSelection ?? state.armedSelection ?? null;
    state.controls = normalizeControls({
      ...state.controls,
      ...(nextState.controls || {}),
      constructionMode: {
        ...state.controls.constructionMode,
        ...(nextState.controls?.constructionMode || {}),
      },
    });
    state.vergilState = nextState.vergilState ?? state.vergilState ?? 'ambient';
    body.innerHTML = renderBody(state);
    shell?.setAttribute('data-orb-mode', state.mode);
    panel?.setAttribute('data-orb-mode', state.mode);
    body?.setAttribute('data-orb-mode', state.mode);
    submit.disabled = state.mode === 'searching';
    input.disabled = false;
    syncControls();
    syncVergilState();
    input.placeholder = state.mode === 'clarification'
      ? state.question || compactPromptForMode(state.mode)
      : compactPromptForMode(state.mode);
    emitNarration(nextState);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    onSubmit?.(query);
  });

  panel.addEventListener('click', (event) => {
    const followOption = event.target.closest('[data-follow-mode]');
    if (followOption) {
      const mode = followOption.dataset.followMode;
      state.controls = normalizeControls({
        ...state.controls,
        followMode: mode,
        followMenuOpen: false,
      });
      syncControls();
      onControlToggle?.('followMode', mode, {
        ...state.controls,
      });
      return;
    }

    const layoutOption = event.target.closest('[data-layout-preset]');
    if (layoutOption) {
      const preset = layoutOption.dataset.layoutPreset;
      state.controls = normalizeControls({
        ...state.controls,
        activeLayoutPreset: preset,
        layoutMenuOpen: false,
      });
      syncControls();
      onControlToggle?.('layoutPreset', preset, {
        ...state.controls,
      });
      return;
    }

    const constructionAction = event.target.closest('[data-construction-action]');
    if (constructionAction) {
      const active = constructionAction.dataset.constructionAction === 'start';
      state.controls = normalizeControls({
        ...state.controls,
        layoutMenuOpen: false,
        constructionMode: {
          ...state.controls.constructionMode,
          active,
          progress: active ? state.controls.constructionMode.progress : 0,
        },
      });
      syncControls();
      onControlToggle?.('constructionMode', active, {
        ...state.controls,
      });
      return;
    }

    const button = event.target.closest('[data-candidate-index]');
    if (button) {
      const index = Number(button.dataset.candidateIndex);
      const candidate = state.candidates[index];
      if (!candidate) return;
      onCandidateSelect?.(candidate);
      return;
    }

    const action = event.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'activate') {
      onActivateSelection?.();
    }
    if (action.dataset.action === 'dismiss') {
      onDismissSelection?.();
    }
  });

  input.addEventListener('focus', () => {
    setFocusState(true);
  });

  input.addEventListener('blur', () => {
    setFocusState(false);
  });

  input.addEventListener('input', () => {
    onInputActivity?.({
      focused: document.activeElement === input,
      active: input.value.trim().length > 0,
      value: input.value,
    });
  });

  controlsHost?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-control]');
    if (!button) return;
    const key = button.dataset.control;
    if (key === 'followMenu') {
      state.controls = normalizeControls({
        ...state.controls,
        followMenuOpen: !state.controls.followMenuOpen,
        layoutMenuOpen: false,
      });
      syncControls();
      return;
    }
    if (key === 'layoutMenu') {
      state.controls = normalizeControls({
        ...state.controls,
        layoutMenuOpen: !state.controls.layoutMenuOpen,
        followMenuOpen: false,
      });
      syncControls();
      return;
    }
    const active = !state.controls[key];
    state.controls = normalizeControls({
      ...state.controls,
      [key]: active,
      ...(key === 'commandMode' ? { followMenuOpen: false, layoutMenuOpen: false } : {}),
    });
    syncControls();
    onControlToggle?.(key, active, {
      ...state.controls,
    });
  });

  function findOpenPopoverTarget(clientX, clientY) {
    const stack = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : [];
    const matched = stack.find((element) => element instanceof HTMLElement
      && element.closest?.('.orb-popover-open')
      && element.closest?.('[data-follow-mode], [data-layout-preset], [data-construction-action]'));
    return matched?.closest?.('[data-follow-mode], [data-layout-preset], [data-construction-action]') || null;
  }

  document.addEventListener('pointerdown', (event) => {
    if (!state.controls.followMenuOpen && !state.controls.layoutMenuOpen) return;
    if (mount.contains(event.target)) return;
    const fallbackTarget = findOpenPopoverTarget(event.clientX, event.clientY);
    if (!fallbackTarget) return;
    redirectedPopoverTarget = fallbackTarget;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  document.addEventListener('click', (event) => {
    if (!redirectedPopoverTarget) return;
    const target = redirectedPopoverTarget;
    redirectedPopoverTarget = null;
    event.preventDefault();
    event.stopPropagation();
    target.click();
  }, true);

  document.addEventListener('pointerdown', (event) => {
    if (!mount.contains(event.target)) {
      if (state.controls.followMenuOpen || state.controls.layoutMenuOpen) {
        state.controls = normalizeControls({
          ...state.controls,
          followMenuOpen: false,
          layoutMenuOpen: false,
        });
        syncControls();
      }
    }
  });

  applyState(state);

  return {
    setState(nextState) {
      applyState(nextState);
    },
    focus() {
      input.focus();
      input.select();
      setFocusState(true);
    },
    setInputValue(value) {
      input.value = value;
      onInputActivity?.({
        focused: document.activeElement === input,
        active: input.value.trim().length > 0,
        value: input.value,
      });
    },
    getInputValue() {
      return input.value;
    },
    getNarrationForState(nextState) {
      return buildNarration({
        ...state,
        ...nextState,
      });
    },
    getHudState() {
      return {
        controls: { ...state.controls },
        vergilState: state.vergilState,
        mode: state.mode,
      };
    },
  };
}
