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
        <div class="retriever-status retriever-status-searching">
          <span class="retriever-spinner" aria-hidden="true"></span>
          <span>Searching the vault</span>
        </div>
      `;
    case 'resolved':
      return `
        <div class="retriever-card retriever-card-resolved">
          <div class="retriever-card-label">Resolved</div>
          <div class="retriever-card-title">${escapeHtml(state.resolved?.title || '')}</div>
          <div class="retriever-card-meta">
            <span>${escapeHtml(state.resolved?.folder || '')}</span>
            <span>${formatScore(state.resolved?.score)}</span>
          </div>
        </div>
      `;
    case 'candidates':
      return `
        <div class="retriever-section-label">Choose a note</div>
        <div class="retriever-candidates">
          ${state.candidates.map((candidate, index) => `
            <button class="retriever-candidate" type="button" data-candidate-index="${index}">
              <div class="retriever-candidate-title">${escapeHtml(candidate.title || '')}</div>
              <div class="retriever-candidate-meta">
                <span>${escapeHtml(candidate.folder || '')}</span>
                <span>${formatScore(candidate.score)}</span>
              </div>
              ${candidate.reason ? `<div class="retriever-candidate-reason">${escapeHtml(candidate.reason)}</div>` : ''}
            </button>
          `).join('')}
        </div>
      `;
    case 'clarification':
      return `
        <div class="retriever-status retriever-status-question">
          <div class="retriever-section-label">Clarification</div>
          <div class="retriever-question">${escapeHtml(state.question)}</div>
        </div>
      `;
    case 'error':
      return `
        <div class="retriever-status retriever-status-error">
          <div class="retriever-section-label">Could not resolve</div>
          <div class="retriever-error-message">${escapeHtml(state.message)}</div>
        </div>
      `;
    case 'idle':
    default:
      return `
        <div class="retriever-status retriever-status-idle">
          <span>Direct retrieval. No essays, just the note.</span>
        </div>
      `;
  }
}

export function createRetrieverPanel({ mount, onSubmit, onCandidateSelect }) {
  mount.innerHTML = `
    <div class="retriever-shell">
      <div class="retriever-panel">
        <div class="retriever-header">
          <div class="retriever-mark">
            <span class="retriever-mark-dot"></span>
            <span class="retriever-mark-label">Retriever</span>
          </div>
          <div class="retriever-toolbar">
            <div class="retriever-subtitle">Direct Retrieval</div>
            <label class="retriever-provider-wrap">
              <span>Provider</span>
              <select class="retriever-provider">
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </label>
          </div>
        </div>
        <form class="retriever-form">
          <input class="retriever-input" type="text" autocomplete="off" spellcheck="false" placeholder="Find a note..." />
          <button class="retriever-submit" type="submit">Open</button>
        </form>
        <div class="retriever-body"></div>
      </div>
    </div>
  `;

  const form = mount.querySelector('.retriever-form');
  const input = mount.querySelector('.retriever-input');
  const body = mount.querySelector('.retriever-body');
  const submit = mount.querySelector('.retriever-submit');
  const provider = mount.querySelector('.retriever-provider');

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
