// Timeline scrubber + growth animation
const PHI = 1.618033988749;

export function createTimeline(graph, onTimeChange) {
  const dates = graph.nodes
    .map(n => n.created)
    .filter(d => typeof d === 'string' && /^\d{4}/.test(d))
    .map(d => new Date(d).getTime())
    .sort((a, b) => a - b);
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  const range = maxDate - minDate || 1;

  let currentTime = maxDate;
  let playing = false;
  let speed = 20;
  let animFrame = null;

  // Build DOM
  const container = document.createElement('div');
  container.id = 'timeline';
  container.style.cssText = 'position:fixed;bottom:0;left:0;right:0;padding:12px 24px;background:rgba(5,5,16,0.88);border-top:1px solid rgba(155,77,255,0.2);z-index:100;font-family:system-ui;display:flex;align-items:center;gap:12px;';

  const playBtn = document.createElement('button');
  playBtn.textContent = '▶';
  playBtn.style.cssText = 'background:rgba(155,77,255,0.2);border:1px solid rgba(155,77,255,0.3);color:#9b4dff;width:32px;height:32px;border-radius:6px;cursor:pointer;font-size:14px;';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1000';
  slider.value = '1000';
  slider.style.cssText = 'flex:1;accent-color:#9b4dff;height:4px;cursor:pointer;';

  const dateLabel = document.createElement('span');
  dateLabel.style.cssText = 'color:#9b4dff;font-size:13px;min-width:90px;text-align:center;';

  const countLabel = document.createElement('span');
  countLabel.style.cssText = 'color:#888;font-size:12px;min-width:120px;text-align:right;';

  const speedBtn = document.createElement('button');
  speedBtn.textContent = '20x';
  speedBtn.style.cssText = 'background:rgba(155,77,255,0.1);border:1px solid rgba(155,77,255,0.2);color:#888;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;';

  container.appendChild(playBtn);
  container.appendChild(slider);
  container.appendChild(dateLabel);
  container.appendChild(countLabel);
  container.appendChild(speedBtn);
  document.body.appendChild(container);

  function timeToDate(t) {
    return new Date(t).toISOString().split('T')[0];
  }

  function updateDisplay() {
    dateLabel.textContent = timeToDate(currentTime);
    const visible = graph.nodes.filter(n => {
      const ts = (typeof n.created === 'string' && /^\d{4}/.test(n.created))
        ? new Date(n.created).getTime() : minDate;
      return ts <= currentTime;
    }).length;
    countLabel.textContent = `${visible} / ${graph.nodes.length} nodes`;
    onTimeChange(currentTime, minDate, maxDate);
  }

  slider.addEventListener('input', () => {
    const pct = parseInt(slider.value) / 1000;
    currentTime = minDate + pct * range;
    updateDisplay();
    if (playing) stopPlay();
  });

  const speeds = [1, 5, 20, 100];
  let speedIdx = 2;
  speedBtn.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    speed = speeds[speedIdx];
    speedBtn.textContent = speed + 'x';
  });

  function startPlay() {
    playing = true;
    playBtn.textContent = '⏸';
    if (currentTime >= maxDate) currentTime = minDate;
    const msPerFrame = (range / 60) * speed / 1000;
    function tick() {
      currentTime += msPerFrame * 16;
      if (currentTime >= maxDate) {
        currentTime = maxDate;
        stopPlay();
      }
      slider.value = String(((currentTime - minDate) / range) * 1000);
      updateDisplay();
      if (playing) animFrame = requestAnimationFrame(tick);
    }
    animFrame = requestAnimationFrame(tick);
  }

  function stopPlay() {
    playing = false;
    playBtn.textContent = '▶';
    if (animFrame) cancelAnimationFrame(animFrame);
  }

  playBtn.addEventListener('click', () => {
    playing ? stopPlay() : startPlay();
  });

  // Space bar play/pause
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      playing ? stopPlay() : startPlay();
    }
  });

  updateDisplay();
  return { container, getCurrentTime: () => currentTime };
}
