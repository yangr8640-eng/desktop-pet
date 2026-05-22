// pet.js - Desktop Pet Logic

const wrapper = document.getElementById('petWrapper');
const bubble = document.getElementById('speechBubble');
const mouthPath = document.getElementById('mouth-path');

/* ─── State ─── */
let isHovering = false;
let isDragging = false;
let dragDistance = 0;
let dragStartX = 0;
let dragStartY = 0;
let dragCounter = 0;
let hoverTimeout = null;

const MOUTH_NORMAL = 'M 90 120 Q 97 128 105 120 Q 113 128 120 120';
const MOUTH_OPEN = 'M 88 116 Q 105 150 122 116';
const MOUTH_WIDE = 'M 85 112 Q 105 155 125 112';

/* ─── Hover ─── */
wrapper.addEventListener('mouseenter', () => {
  isHovering = true;
  wrapper.classList.add('greeting');
  showBubble('嗨~ 🐾');

  clearTimeout(hoverTimeout);
  hoverTimeout = setTimeout(() => {
    wrapper.classList.remove('greeting');
    hideBubble();
  }, 1500);
});

wrapper.addEventListener('mouseleave', () => {
  isHovering = false;
  hideBubble();
});

/* ─── Click vs Drag ─── */
wrapper.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragDistance = 0;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.screenX - dragStartX;
  const dy = e.screenY - dragStartY;
  dragDistance += Math.abs(dx) + Math.abs(dy);
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  window.petAPI.moveWindow(dx, dy);
});

document.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;

  if (dragDistance < 5) {
    // It was a click
    if (!wrapper.classList.contains('dragover')) {
      window.petAPI.openChat();
    }
  } else {
    // It was a drag - save position
    window.petAPI.savePosition();
  }
});

/* ─── Drag & Drop files ─── */
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  if (dragCounter === 1) {
    wrapper.classList.add('dragover');
    setMouthOpen(true);
    showBubble('给我看看~ 👀');
  }
});

document.addEventListener('dragleave', (e) => {
  dragCounter--;
  if (dragCounter === 0) {
    wrapper.classList.remove('dragover');
    setMouthOpen(false);
    if (!isHovering) hideBubble();
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  wrapper.classList.remove('dragover');
  setMouthOpen(false);
  hideBubble();

  const file = e.dataTransfer.files[0];
  if (!file || !file.path) return;

  // Eating animation
  setMouthOpen(true);
  showBubble('嚼嚼... 🤤');
  await sleep(400);
  setMouthOpen(false);

  // Analyze
  showBubble('分析中... 📄');
  const result = await window.petAPI.analyzeFile(file.path);
  hideBubble();

  // Open chat to show result
  window.petAPI.openChat();
});

/* ─── Mouth animation ─── */
function setMouthOpen(open) {
  if (open) {
    mouthPath.setAttribute('d', MOUTH_WIDE);
    mouthPath.setAttribute('stroke', '#4A0000');
    mouthPath.setAttribute('stroke-width', '1.5');
    mouthPath.setAttribute('fill', '#2C1810');
    mouthPath.setAttribute('fill-opacity', '0.9');
  } else {
    mouthPath.setAttribute('d', MOUTH_NORMAL);
    mouthPath.setAttribute('stroke', '#2C1810');
    mouthPath.setAttribute('stroke-width', '2.2');
    mouthPath.setAttribute('fill', 'none');
    mouthPath.setAttribute('fill-opacity', '1');
  }
}

/* ─── Speech bubble ─── */
function showBubble(text) {
  bubble.textContent = text;
  bubble.classList.add('show');
}

function hideBubble() {
  bubble.classList.remove('show');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ─── Random idle behaviors ─── */
const idleMessages = ['好无聊喵~', '主人呢？🐾', '呼噜噜...', '今天天气真好☀️', '喵~', '...'];

setInterval(() => {
  if (!isHovering && !wrapper.classList.contains('dragover') && !bubble.classList.contains('show')) {
    const msg = idleMessages[Math.floor(Math.random() * idleMessages.length)];
    showBubble(msg);
    setTimeout(() => {
      if (!isHovering) hideBubble();
    }, 2500);
  }
}, 30000); // Every 30 seconds
