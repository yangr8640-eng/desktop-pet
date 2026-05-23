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
  showBubble(currentMessages.greeting);

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
    showBubble(currentMessages.dragHere);
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
  showBubble(currentMessages.eating);
  await sleep(400);
  setMouthOpen(false);

  // Analyze
  showBubble(currentMessages.analyzing);
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

/* ─── Theme-specific speech messages ─── */
const themeMessages = {
  orange: {
    greeting: '嗨~ 🧡',
    idle: ['好无聊呀~', '主人呢？💛', '今天天气真好☀️', '嘻嘻~', '想你啦~', '...'],
    dragHere: '给我看看~ 👀',
    eating: '嚼嚼... 🤤',
    analyzing: '分析中... 📄'
  },
  yellow: {
    greeting: '嗨~ 💛',
    idle: ['好无聊呀~', '主人呢？💛', '今天天气真好☀️', '嘻嘻~', '想你啦~', '...'],
    dragHere: '给我看看~ 👀',
    eating: '嚼嚼... 🤤',
    analyzing: '分析中... 📄'
  },
  warrior: {
    greeting: '向您致敬，战士。⚔️',
    idle: ['警戒中... 🛡️', '等待指令。📜', '帝皇庇佑。🏛️', '秩序即胜利。⚔️', '马库拉格之光不灭。', '阵型稳固。'],
    dragHere: '提交情报，战士。📜',
    eating: '接收情报中...',
    analyzing: '战略分析中... 📜'
  }
};

let currentMessages = themeMessages.orange;
let currentThemeEmoji = '🧡';

/* ─── Theme ─── */
function applyPetTheme(theme) {
  petNormalImg.src = theme.svgs.normal;
  petMouthOpenImg.src = theme.svgs.mouthOpen;
  currentThemeEmoji = theme.emoji;
  currentMessages = themeMessages[theme.id] || themeMessages.orange;

  // Warrior SVGs have large viewBox, size to match other themes
  if (theme.id === 'warrior') {
    petNormalImg.style.width = '128px';
    petNormalImg.style.height = '128px';
    petMouthOpenImg.style.width = '128px';
    petMouthOpenImg.style.height = '128px';
  } else {
    petNormalImg.style.width = '';
    petNormalImg.style.height = '';
    petMouthOpenImg.style.width = '';
    petMouthOpenImg.style.height = '';
  }
}

window.petAPI.onThemeChanged((theme) => applyPetTheme(theme));

(async () => {
  const theme = await window.petAPI.getTheme();
  applyPetTheme(theme);
})();

setInterval(() => {
  if (!isHovering && !wrapper.classList.contains('dragover') && !bubble.classList.contains('show')) {
    const msgs = currentMessages.idle;
    const msg = msgs[Math.floor(Math.random() * msgs.length)];
    showBubble(msg);
    setTimeout(() => {
      if (!isHovering) hideBubble();
    }, 2500);
  }
}, 30000); // Every 30 seconds
