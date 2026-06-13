// pet.js - Desktop Pet Logic (Multi-Expression)

const wrapper = document.getElementById('petWrapper');
const bubble = document.getElementById('speechBubble');
const petImg = document.getElementById('petImg');

/* ─── State ─── */
let isHovering = false;
let isDragging = false;
let dragDistance = 0;
let dragStartX = 0;
let dragStartY = 0;
let dragCounter = 0;
let hoverTimeout = null;

let currentExpression = 'normal';
let prevExpression = 'normal';
let currentTheme = null;
let idleTimer = null;
let expressionCycleTimer = null;
let lastInteractionTime = Date.now();

/* ─── Prevent native image drag ─── */
petImg.addEventListener('dragstart', (e) => e.preventDefault());

/* ─── Expression Management ─── */
function setExpression(name) {
  if (!currentTheme) return;
  const expr = currentTheme.expressions || currentTheme.svgs;
  if (!expr[name]) return; // expression not available

  prevExpression = currentExpression;
  currentExpression = name;
  petImg.src = expr[name];

  // Update bubble position based on theme config
  updateBubblePosition(name);
}

function updateBubblePosition(exprName) {
  if (!currentTheme) return;
  if (currentTheme.id === 'warrior') {
    bubble.style.top = '-12px';
  } else if (currentTheme.id === 'claude') {
    bubble.style.top = '-30px';
  } else {
    bubble.style.top = '-12px';
  }
}

/* ─── Idle Expression Cycling ─── */
function startIdleCycling() {
  stopIdleCycling();
  const idleExprs = currentTheme?.idleExpressions;
  if (!idleExprs || idleExprs.length <= 1) return;

  expressionCycleTimer = setInterval(() => {
    const now = Date.now();
    const idleSeconds = (now - lastInteractionTime) / 1000;
    const sleepAfter = currentTheme?.sleepAfterSeconds || 0;

    // Check if we should switch to sleep
    if (sleepAfter > 0 && idleSeconds > sleepAfter) {
      const expr = currentTheme.expressions || currentTheme.svgs;
      if (expr['sleep'] && currentExpression !== 'sleep' && !wrapper.classList.contains('dragover')) {
        setExpression('sleep');
      }
      return;
    }

    // Cycle through idle expressions
    if (!isHovering && !wrapper.classList.contains('dragover')) {
      const available = idleExprs.filter(e => e !== currentExpression);
      if (available.length > 0) {
        const next = available[Math.floor(Math.random() * available.length)];
        setExpression(next);
      }
    }
  }, 8000); // every 8 seconds
}

function stopIdleCycling() {
  if (expressionCycleTimer) {
    clearInterval(expressionCycleTimer);
    expressionCycleTimer = null;
  }
}

function recordInteraction() {
  lastInteractionTime = Date.now();
}

/* ─── Hover ─── */
wrapper.addEventListener('mouseover', (e) => {
  if (isHovering || wrapper.contains(e.relatedTarget)) return;
  isHovering = true;
  recordInteraction();
  wrapper.classList.add('greeting');

  // Try happy expression, fall back to normal
  const expr = currentTheme?.expressions || currentTheme?.svgs;
  if (expr && expr['happy'] && currentExpression !== 'mouthOpen') {
    setExpression('happy');
  }
  showBubble(currentMessages.greeting);

  clearTimeout(hoverTimeout);
  hoverTimeout = setTimeout(() => {
    wrapper.classList.remove('greeting');
    hideBubble();
    if (currentExpression === 'happy') {
      setExpression('normal');
    }
  }, 1500);
});

wrapper.addEventListener('mouseout', (e) => {
  if (!isHovering || wrapper.contains(e.relatedTarget)) return;
  isHovering = false;
  recordInteraction();
  hideBubble();
  if (currentExpression === 'happy') {
    setExpression('normal');
  }
});

/* ─── Click vs Drag ─── */
wrapper.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragDistance = 0;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  recordInteraction();
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
    if (!wrapper.classList.contains('dragover')) {
      window.petAPI.openChat();
    }
  } else {
    window.petAPI.savePosition();
  }
});

/* ─── Drag & Drop files ─── */
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  if (dragCounter === 1) {
    wrapper.classList.add('dragover');
    setExpression('mouthOpen');
    showBubble(currentMessages.dragHere);
  }
});

document.addEventListener('dragleave', (e) => {
  dragCounter--;
  if (dragCounter === 0) {
    wrapper.classList.remove('dragover');
    setExpression('normal');
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
  hideBubble();

  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (currentExpression === 'mouthOpen') setExpression('normal');

  const filePath = window.petAPI.getFilePath(file);
  if (!filePath) return;

  // Eating animation
  setExpression('mouthOpen');
  showBubble(currentMessages.eating);
  await sleep(400);
  setExpression('normal');

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
  },
  claude: {
    greeting: '> Hello, world. 💠',
    idle: ['> idle...', '> listening...', '> ready for input.', '> thinking... 🤔', '> compiling thoughts...', '> awaiting prompt.'],
    dragHere: '> drop file here... 📂',
    eating: '> reading bytes...',
    analyzing: '> analyzing... 🔍'
  }
};

let currentMessages = themeMessages.claude;
let currentThemeEmoji = '💠';

/* ─── Theme ─── */
function applyPetTheme(theme) {
  currentTheme = theme;

  // Use expressions if available, fall back to svgs
  const expr = theme.expressions || theme.svgs;
  const defaultExpr = expr.normal || Object.values(expr)[0];
  if (defaultExpr) {
    petImg.src = defaultExpr;
  }

  currentThemeEmoji = theme.emoji;
  currentMessages = themeMessages[theme.id] || themeMessages.orange;

  // Apply cyber/code bubble style
  if (theme.bubbleStyle === 'cyber') {
    bubble.classList.add('cyber');
  } else {
    bubble.classList.remove('cyber');
  }

  // Per-theme sizing
  if (theme.id === 'warrior') {
    petImg.style.width = '128px';
    petImg.style.height = '128px';
    bubble.style.top = '-12px';
    bubble.style.maxWidth = '';
    window.petAPI.resizePet(145, 170);
  } else if (theme.id === 'claude') {
    petImg.style.width = '85px';
    petImg.style.height = '85px';
    bubble.style.top = '-30px';
    bubble.style.maxWidth = '120px';
    window.petAPI.resizePet(140, 170);
  } else {
    petImg.style.width = '';
    petImg.style.height = '';
    bubble.style.top = '-12px';
    bubble.style.maxWidth = '';
    window.petAPI.resizePet(145, 170);
  }

  currentExpression = 'normal';
  startIdleCycling();
}

window.petAPI.onThemeChanged((theme) => applyPetTheme(theme));

(async () => {
  const theme = await window.petAPI.getTheme();
  applyPetTheme(theme);
})();

/* ─── Idle speech bubble cycling ─── */
setInterval(() => {
  if (!isHovering && !wrapper.classList.contains('dragover') && !bubble.classList.contains('show')) {
    const msgs = currentMessages.idle;
    const msg = msgs[Math.floor(Math.random() * msgs.length)];
    showBubble(msg);
    setTimeout(() => {
      if (!isHovering) hideBubble();
    }, 2500);
  }
}, 30000);

/* ─── Expose expression API for chat ─── */
window.setPetExpression = function(name) {
  if (currentTheme) {
    const expr = currentTheme.expressions || currentTheme.svgs;
    if (expr[name]) {
      setExpression(name);
      // Auto-revert to normal after 3 seconds for non-persistent expressions
      if (name !== 'normal' && name !== 'mouthOpen') {
        setTimeout(() => {
          if (currentExpression === name) setExpression('normal');
        }, 3000);
      }
    }
  }
};
