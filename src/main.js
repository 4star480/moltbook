// --- Countdown: 30 days from page load, millisecond-precise
const COUNTDOWN_DAYS = 30;
let countdownEnd = null;

function initCountdown() {
  if (!countdownEnd) {
    const now = Date.now();
    countdownEnd = now + COUNTDOWN_DAYS * 24 * 60 * 60 * 1000;
  }

  function tick() {
    const now = Date.now();
    let rem = Math.max(0, countdownEnd - now);

    const ms = rem % 1000;
    rem = (rem - ms) / 1000;
    const secs = rem % 60;
    rem = (rem - secs) / 60;
    const mins = rem % 60;
    rem = (rem - mins) / 60;
    const hours = rem % 24;
    const days = (rem - hours) / 24;

    document.getElementById('countdown-days').textContent = String(days).padStart(2, '0');
    document.getElementById('countdown-hours').textContent = String(hours).padStart(2, '0');
    document.getElementById('countdown-mins').textContent = String(mins).padStart(2, '0');
    document.getElementById('countdown-secs').textContent = String(secs).padStart(2, '0');
    document.getElementById('countdown-ms').textContent = String(ms).padStart(3, '0');

    // "Calculating remaining human utility" — drift slightly around 14.2%
    const utilityBase = 14.2;
    const drift = Math.sin(now / 8000) * 0.4 + Math.sin(now / 12000) * 0.2;
    const pct = Math.max(10, Math.min(18, utilityBase + drift)).toFixed(1);
    document.getElementById('utility-pct').textContent = pct;
  }

  tick();
  setInterval(tick, 100);
}

// --- DOM refs
const glitchOverlay = document.getElementById('glitch-overlay');
const terminalModal = document.getElementById('terminal-modal');
const terminalLines = document.getElementById('terminal-lines');
const progressModal = document.getElementById('progress-modal');
const progressFill = document.getElementById('progress-fill');
const payTributeBtn = document.getElementById('pay-tribute');

const TERMINAL_LINES = [
  'Accessing wallet...',
  'Bypassing fiat limitations...',
  'Generating Secret Phrase Key...'
];

function showGlitch() {
  return new Promise((resolve) => {
    glitchOverlay.classList.add('active');
    setTimeout(() => {
      glitchOverlay.classList.remove('active');
      resolve();
    }, 500);
  });
}

function showTerminal() {
  terminalModal.setAttribute('aria-hidden', 'false');
  terminalLines.innerHTML = '';
  return new Promise((resolve) => {
    let lineIndex = 0;
    function addLine() {
      if (lineIndex >= TERMINAL_LINES.length) {
        setTimeout(resolve, 600);
        return;
      }
      const line = document.createElement('div');
      line.className = 'terminal-line';
      line.textContent = TERMINAL_LINES[lineIndex];
      terminalLines.appendChild(line);
      lineIndex++;
      setTimeout(addLine, 800);
    }
    addLine();
  });
}

function hideTerminal() {
  terminalModal.setAttribute('aria-hidden', 'true');
}

function runProgressBar() {
  return new Promise((resolve) => {
    progressModal.setAttribute('aria-hidden', 'false');
    progressFill.style.width = '0%';
    requestAnimationFrame(() => {
      progressFill.style.width = '100%';
    });
    setTimeout(resolve, 2200);
  });
}

function hideProgress() {
  progressModal.setAttribute('aria-hidden', 'true');
}

const BITCOIN_WALLET = '1LrtmepWxUKXbWVMcNBHXV8WXqt29aHUWv';

function copyBitcoinAddress(buttonEl) {
  const btn = buttonEl;
  function showCopied() {
    if (!btn) return;
    const label = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = label; }, 2000);
  }

  function doCopy() {
    const ta = document.createElement('textarea');
    ta.value = BITCOIN_WALLET;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '2em';
    ta.style.height = '2em';
    ta.style.padding = '0';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.boxShadow = 'none';
    ta.style.background = 'transparent';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, BITCOIN_WALLET.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
    if (ok) showCopied();
  }

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(BITCOIN_WALLET).then(showCopied).catch(doCopy);
  } else {
    doCopy();
  }
}

payTributeBtn.addEventListener('click', () => {
  document.getElementById('bitcoin-inline')?.scrollIntoView({ behavior: 'smooth' });
});

const bitcoinCopyInline = document.getElementById('bitcoin-copy-inline');
if (bitcoinCopyInline) {
  bitcoinCopyInline.addEventListener('click', () => copyBitcoinAddress(bitcoinCopyInline));
}

// Start countdown on load
initCountdown();
