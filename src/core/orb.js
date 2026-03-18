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

function renderBody(state) {
  switch (state.mode) {
    case 'searching':
      return `
        <div class="orb-status orb-status-searching">
          <span class="orb-spinner" aria-hidden="true"></span>
          <span>Searching the vault</span>
        </div>
      `;
    case 'resolved':
      return `
        <div class="orb-card orb-card-resolved">
          <div class="orb-card-label">Resolved</div>
          <div class="orb-card-title">${escapeHtml(state.resolved?.title || '')}</div>
          <div class="orb-card-meta">
            <span>${escapeHtml(state.resolved?.folder || '')}</span>
            <span>${formatScore(state.resolved?.score)}</span>
          </div>
        </div>
      `;
    case 'candidates':
      return `
        <div class="orb-section-label">Choose a note</div>
        <div class="orb-candidates">
          ${state.candidates.map((candidate, index) => `
            <button class="orb-candidate" type="button" data-candidate-index="${index}">
              <div class="orb-candidate-title">${escapeHtml(candidate.title || '')}</div>
              <div class="orb-candidate-meta">
                <span>${escapeHtml(candidate.folder || '')}</span>
                <span>${formatScore(candidate.score)}</span>
              </div>
              ${candidate.reason ? `<div class="orb-candidate-reason">${escapeHtml(candidate.reason)}</div>` : ''}
            </button>
          `).join('')}
        </div>
      `;
    case 'clarification':
      return `
        <div class="orb-status orb-status-question">
          <div class="orb-section-label">Clarification</div>
          <div class="orb-question">${escapeHtml(state.question)}</div>
        </div>
      `;
    case 'error':
      return `
        <div class="orb-status orb-status-error">
          <div class="orb-section-label">Could not resolve</div>
          <div class="orb-error-message">${escapeHtml(state.message)}</div>
        </div>
      `;
    case 'idle':
    default:
      return `
        <div class="orb-status orb-status-idle">
          <span>Direct retrieval. No essays, just the note.</span>
        </div>
      `;
  }
}

export function createOrb({ mount, onSubmit, onCandidateSelect }) {
  mount.innerHTML = `
    <div class="orb-shell">
      <div class="orb-panel">
        <div class="orb-header">
          <div class="orb-mark">
            <span class="orb-mark-dot"></span>
            <span class="orb-mark-label">Orb</span>
          </div>
          <div class="orb-toolbar">
            <div class="orb-subtitle">Direct retrieval</div>
            <label class="orb-provider-wrap">
              <span>Provider</span>
              <select class="orb-provider">
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </label>
          </div>
        </div>
        <form class="orb-form">
          <input class="orb-input" type="text" autocomplete="off" spellcheck="false" placeholder="Find a note..." />
          <button class="orb-submit" type="submit">Open</button>
        </form>
        <div class="orb-body"></div>
      </div>
    </div>
  `;

  const form = mount.querySelector('.orb-form');
  const input = mount.querySelector('.orb-input');
  const body = mount.querySelector('.orb-body');
  const submit = mount.querySelector('.orb-submit');
  const provider = mount.querySelector('.orb-provider');

  const state = {
    mode: 'idle',
    candidates: [],
    question: '',
    message: '',
    resolved: null,
  };

  function applyState(nextState) {
    state.mode = nextState.mode || 'idle';
    state.candidates = nextState.candidates || [];
    state.question = nextState.question || '';
    state.message = nextState.message || '';
    state.resolved = nextState.resolved || null;
    body.innerHTML = renderBody(state);
    submit.disabled = state.mode === 'searching';
    provider.disabled = state.mode === 'searching';
    input.disabled = false;
    input.placeholder = state.mode === 'clarification' ? state.question || 'Clarify the note...' : 'Find a note...';
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    onSubmit?.(query, {
      provider: provider.value,
    });
  });

  body.addEventListener('click', (event) => {
    const button = event.target.closest('[data-candidate-index]');
    if (!button) return;
    const index = Number(button.dataset.candidateIndex);
    const candidate = state.candidates[index];
    if (!candidate) return;
    onCandidateSelect?.(candidate);
  });

  applyState(state);

  return {
    setState(nextState) {
      applyState(nextState);
    },
    focus() {
      input.focus();
      input.select();
    },
    setInputValue(value) {
      input.value = value;
    },
    getInputValue() {
      return input.value;
    },
    getProvider() {
      return provider.value;
    },
  };
}
