// pet.js - Desktop Pet Logic

const wrapper = document.getElementById('petWrapper');
const bubble = document.getElementById('speechBubble');
const petNormalImg = document.getElementById('petNormalImg');
const petMouthOpenImg = document.getElementById('petMouthOpenImg');

/* ─── State ─── */
let isHovering = false;
let isDragging = false;
let dragDistance = 0;
let dragStartX = 0;
let dragStartY = 0;
let dragCounter = 0;
let hoverTimeout = null;

/* ─── Prevent native image drag ─── */
document.querySelectorAll('.pet-img').forEach(img => {
  img.addEventListener('dragstart', (e) => e.preventDefault());
});

/* ─── Hover ─── */
wrapper.addEventListener('mouseover', (e) => {
  if (isHovering || wrapper.contains(e.relatedTarget)) return;
  isHovering = true;
  wrapper.classList.add('greeting');
  showBubble(`嗨~ ${currentThemeEmoji}`);

  clearTimeout(hoverTimeout);
  hoverTimeout = setTimeout(() => {
    wrapper.classList.remove('greeting');
    hideBubble();
  }, 1500);
});

wrapper.addEventListener('mouseout', (e) => {
  if (!isHovering || wrapper.contains(e.relatedTarget)) return;
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
  if (!file) return;

  const filePath = window.petAPI.getFilePath(file);
  if (!filePath) return;

  // Eating animation
  setMouthOpen(true);
  showBubble('嚼嚼... 🤤');
  await sleep(400);
  setMouthOpen(false);

  // Analyze
  showBubble('分析中... 📄');
  try {
    await window.petAPI.analyzeFile(filePath);
  } catch (err) {
    console.error('File analysis error:', err);
  } finally {
    hideBubble();
    window.petAPI.showChat();
  }
});

/* ─── Mouth animation ─── */
function setMouthOpen(open) {
  if (open) {
    petNormalImg.style.display = 'none';
    petMouthOpenImg.style.display = 'block';
  } else {
    petNormalImg.style.display = 'block';
    petMouthOpenImg.style.display = 'none';
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
const idleMessages = ['好无聊呀~', '主人呢？💛', '今天天气真好☀️', '嘻嘻~', '想你啦~', '...'];

let currentThemeEmoji = '🧡';

/* ─── Theme ─── */
function applyPetTheme(theme) {
  petNormalImg.src = theme.svgs.normal;
  petMouthOpenImg.src = theme.svgs.mouthOpen;
  currentThemeEmoji = theme.emoji;
}

window.petAPI.onThemeChanged((theme) => applyPetTheme(theme));

(async () => {
  const theme = await window.petAPI.getTheme();
  applyPetTheme(theme);
})();

setInterval(() => {
  if (!isHovering && !wrapper.classList.contains('dragover') && !bubble.classList.contains('show')) {
    const msg = idleMessages[Math.floor(Math.random() * idleMessages.length)];
    showBubble(msg);
    setTimeout(() => {
      if (!isHovering) hideBubble();
    }, 2500);
  }
}, 30000); // Every 30 seconds
