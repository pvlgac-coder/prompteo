/* ═══════════════════════════════════════════════════════
   Prompteo — Application principale
   Prompteur à reconnaissance vocale (Web Speech API)
   Mobile-First
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── DOM refs ───
  const drawer         = document.getElementById('drawer');
  const drawerOverlay  = document.getElementById('drawer-overlay');
  const drawerHandle   = document.getElementById('drawer-handle');
  const btnSettings    = document.getElementById('btn-settings');
  const scriptInput    = document.getElementById('script-input');
  const btnLoad        = document.getElementById('btn-load');
  const btnReset       = document.getElementById('btn-reset');
  const btnFab         = document.getElementById('btn-fab');
  const fabIconPlay    = document.getElementById('fab-icon-play');
  const fabIconStop    = document.getElementById('fab-icon-stop');
  const fontSlider     = document.getElementById('font-slider');
  const fontSizeValue  = document.getElementById('font-size-value');
  const tolSlider      = document.getElementById('tolerance-slider');
  const tolValue       = document.getElementById('tolerance-value');
  const promptText     = document.getElementById('prompt-text');
  const debugHeard     = document.getElementById('debug-heard');
  const micDotTop      = document.getElementById('mic-dot-top');

  // ─── State ───
  let words          = [];
  let currentIndex   = 0;
  let isListening    = false;
  let recognition    = null;
  let fuzzyThreshold = 0.55;

  // Sécurité anti-saut : jamais plus de N mots d'avance par résultat vocal
  const MAX_ADVANCE_PER_RESULT = 6;
  // Fenêtre de recherche réduite pour éviter les correspondances lointaines
  const LOOKAHEAD = 12;

  // ════════════════════════════════════════════
  // 1. DRAWER (Bottom Sheet)
  // ════════════════════════════════════════════
  function openDrawer() {
    drawer.classList.add('open');
    drawerOverlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('visible');
    document.body.style.overflow = '';
  }

  btnSettings.addEventListener('click', openDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  // ─── Drag to close (swipe down) ───
  let dragStartY = 0;
  let dragCurrentY = 0;
  let isDragging = false;

  function onDragStart(e) {
    isDragging = true;
    dragStartY = e.touches ? e.touches[0].clientY : e.clientY;
    dragCurrentY = dragStartY;
    drawer.style.transition = 'none';
  }

  function onDragMove(e) {
    if (!isDragging) return;
    dragCurrentY = e.touches ? e.touches[0].clientY : e.clientY;
    const delta = dragCurrentY - dragStartY;
    if (delta > 0) {
      drawer.style.transform = `translateY(${delta}px)`;
    }
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    drawer.style.transition = '';
    const delta = dragCurrentY - dragStartY;
    if (delta > 100) {
      drawer.style.transform = '';
      closeDrawer();
    } else {
      drawer.style.transform = '';
    }
  }

  drawerHandle.addEventListener('touchstart', onDragStart, { passive: true });
  drawerHandle.addEventListener('touchmove', onDragMove, { passive: true });
  drawerHandle.addEventListener('touchend', onDragEnd);
  drawerHandle.addEventListener('mousedown', onDragStart);
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);

  // ════════════════════════════════════════════
  // 2. CHARGEMENT DU SCRIPT
  // ════════════════════════════════════════════
  btnLoad.addEventListener('click', () => {
    const raw = scriptInput.value.trim();
    if (!raw) return;
    loadScript(raw);
    closeDrawer();
  });

  function normalizeWord(w) {
    return w
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function loadScript(text) {
    promptText.innerHTML = '';
    words = [];
    currentIndex = 0;

    const sentences = text.split(/(?<=[.!?…;:\n])\s*/);

    sentences.forEach((sentence, si) => {
      if (!sentence.trim()) return;

      const tokenList = sentence.trim().split(/\s+/);
      tokenList.forEach((token) => {
        const span = document.createElement('span');
        span.className = 'word upcoming';
        span.textContent = token + ' ';
        span.dataset.index = words.length;
        promptText.appendChild(span);

        words.push({
          el: span,
          raw: token,
          normalized: normalizeWord(token),
        });
      });

      if (si < sentences.length - 1) {
        const br = document.createElement('span');
        br.className = 'sentence-break';
        promptText.appendChild(br);
      }
    });

    console.log(`%c[Prompteo] Script chargé — ${words.length} mots`, 'color:#ffd600;font-weight:bold');
    btnFab.disabled = false;
    btnReset.disabled = false;
    window.scrollTo({ top: 0 });
  }

  // ════════════════════════════════════════════
  // 3. SLIDERS
  // ════════════════════════════════════════════
  fontSlider.addEventListener('input', () => {
    const v = fontSlider.value;
    fontSizeValue.textContent = v;
    document.documentElement.style.setProperty('--font-size', v + 'rem');
  });

  tolSlider.addEventListener('input', () => {
    fuzzyThreshold = parseFloat(tolSlider.value);
    tolValue.textContent = fuzzyThreshold.toFixed(2);
  });

  // ════════════════════════════════════════════
  // 4. RECONNAISSANCE VOCALE
  // ════════════════════════════════════════════
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    alert('Ton navigateur ne supporte pas la Web Speech API.\nUtilise Chrome sur Android ou Chrome sur desktop.');
  }

  function setMicActive(active) {
    micDotTop.classList.toggle('active', active);
    btnFab.classList.toggle('listening', active);
    fabIconPlay.style.display = active ? 'none' : 'block';
    fabIconStop.style.display = active ? 'block' : 'none';
  }

  function createRecognition() {
    const rec = new SpeechRecognition();
    rec.continuous      = true;
    rec.interimResults  = true;
    rec.lang            = 'fr-FR';
    rec.maxAlternatives = 3;

    rec.onstart = () => {
      console.log('%c[Prompteo] 🎙️ Écoute démarrée', 'color:#4caf50');
      setMicActive(true);
      debugHeard.textContent = 'Écoute active... Parlez maintenant.';
      debugHeard.style.color = 'var(--accent)';
    };

    rec.onsoundstart  = () => console.log('%c[Prompteo] 🔊 Son détecté',   'color:#ffd600');
    rec.onspeechstart = () => console.log('%c[Prompteo] 🗣️ Parole...',     'color:#ffd600');

    rec.onend = () => {
      console.log('%c[Prompteo] 🎙️ Écoute stoppée', 'color:#ff4444');
      setMicActive(false);

      if (window.location.protocol === 'file:') {
        stopListening();
        return;
      }
      if (isListening) {
        console.log('%c[Prompteo] ↻ Redémarrage auto…', 'color:#ffd600');
        try { recognition.start(); } catch (_) {}
      }
    };

    rec.onerror = (e) => {
      console.warn('[Prompteo] Erreur SR:', e.error, e);
      debugHeard.textContent = `Erreur : ${e.error}`;
      debugHeard.style.color = 'var(--danger)';

      if (e.error === 'network') {
        alert('Erreur réseau. La reconnaissance vocale nécessite une connexion internet active.');
      }
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        let msg = 'Accès au micro refusé.';
        if (navigator.userAgent.toLowerCase().includes('brave')) {
          msg += '\n\nSur Brave : activez "Utiliser les services Google pour la reconnaissance vocale" dans brave://settings/privacy';
        }
        alert(msg);
        stopListening();
      }
    };

    rec.onresult = handleResult;
    return rec;
  }

  // ════════════════════════════════════════════
  // 5. TRAITEMENT DES RÉSULTATS
  // ════════════════════════════════════════════
  function handleResult(event) {
    console.log(`[Prompteo] onresult (${event.results.length} résultats)`);
    let transcript = '';
    let isFinal = false;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
      if (event.results[i].isFinal) isFinal = true;
    }

    transcript = transcript.trim();
    if (!transcript) return;

    debugHeard.textContent = transcript;
    debugHeard.style.color = '';

    const heardWords = transcript.split(/\s+/).map(normalizeWord).filter(w => w.length > 0);

    console.log(
      `%c[SR ${isFinal ? 'FINAL' : 'interim'}]%c "${transcript}" → [${heardWords.join(', ')}]`,
      isFinal ? 'color:#4caf50;font-weight:bold' : 'color:#888', 'color:inherit'
    );

    if (heardWords.length === 0) return;
    matchHeardWords(heardWords, isFinal);
  }

  function matchHeardWords(heardWords, isFinal) {
    const searchEnd  = Math.min(currentIndex + LOOKAHEAD, words.length);
    // On mémorise l'index de départ AVANT la boucle pour que le plafond
    // s'applique sur l'ensemble du résultat vocal, pas mot par mot
    const startIndex = currentIndex;

    for (const heard of heardWords) {
      if (heard.length < 2) continue;

      let bestScore = 0;
      let bestIdx   = -1;

      for (let i = currentIndex; i < searchEnd; i++) {
        const scriptWord = words[i].normalized;
        if (scriptWord.length < 2) continue;
        const score = similarity(heard, scriptWord);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }

      if (bestScore >= fuzzyThreshold && bestIdx >= 0) {
        // ── PLAFOND : on ne saute jamais plus de MAX_ADVANCE_PER_RESULT mots
        //    depuis la position de départ du résultat vocal
        const maxAllowed = startIndex + MAX_ADVANCE_PER_RESULT - 1;
        const cappedIdx  = Math.min(bestIdx, maxAllowed);

        if (cappedIdx !== bestIdx) {
          console.log(
            `  ⚠️ saut plafonné : "${heard}" matchait idx ${bestIdx} → limité à ${cappedIdx}`,
            `(max +${MAX_ADVANCE_PER_RESULT} depuis ${startIndex})`
          );
        } else {
          console.log(`  ✓ "${heard}" ≈ "${words[bestIdx].raw}" (score: ${bestScore.toFixed(2)}, idx ${bestIdx})`);
        }
        advanceTo(cappedIdx);
      } else if (isFinal) {
        console.log(`  ✗ "${heard}" (meilleur score: ${bestScore.toFixed(2)})`);
      }
    }
  }

  // ════════════════════════════════════════════
  // 6. AVANCEMENT ET SCROLL
  // ════════════════════════════════════════════
  function advanceTo(idx) {
    for (let i = currentIndex; i <= idx; i++) {
      words[i].el.classList.remove('upcoming', 'active');
      words[i].el.classList.add('spoken');
    }

    currentIndex = idx + 1;

    if (currentIndex < words.length) {
      words[currentIndex].el.classList.remove('upcoming');
      words[currentIndex].el.classList.add('active');
      scrollToWord(currentIndex);
    }

    if (currentIndex >= words.length) {
      console.log('%c[Prompteo] ✅ Script terminé !', 'color:#4caf50;font-weight:bold');
      stopListening();
    }
  }

  function scrollToWord(idx) {
    const el = words[idx].el;
    const rect = el.getBoundingClientRect();
    const targetY = window.scrollY + rect.top - window.innerHeight * 0.2;
    window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
  }

  // ════════════════════════════════════════════
  // 7. FUZZY MATCHING
  // ════════════════════════════════════════════
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i-1] === b[j-1]
          ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return dp[m][n];
  }

  function similarity(a, b) {
    if (a === b) return 1;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - levenshtein(a, b) / maxLen;
  }

  // ════════════════════════════════════════════
  // 8. START / STOP (FAB)
  // ════════════════════════════════════════════
  btnFab.addEventListener('click', () => {
    if (isListening) stopListening();
    else startListening();
  });

  function startListening() {
    if (words.length === 0) return;

    recognition = createRecognition();
    isListening = true;
    recognition.start();

    if (currentIndex < words.length) {
      words[currentIndex].el.classList.remove('upcoming');
      words[currentIndex].el.classList.add('active');
    }
  }

  function stopListening() {
    isListening = false;
    if (recognition) { recognition.abort(); recognition = null; }
    setMicActive(false);
  }

  // ════════════════════════════════════════════
  // 9. RESET
  // ════════════════════════════════════════════
  btnReset.addEventListener('click', () => {
    stopListening();
    currentIndex = 0;
    words.forEach(w => {
      w.el.classList.remove('spoken', 'active');
      w.el.classList.add('upcoming');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    debugHeard.textContent = '—';
    debugHeard.style.color = '';
    console.log('%c[Prompteo] ↻ Reset', 'color:#ffd600');
  });

  // ════════════════════════════════════════════
  // 10. RACCOURCIS CLAVIER (desktop)
  // ════════════════════════════════════════════
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      btnFab.click();
    }
    if (e.code === 'Escape') closeDrawer();
  });

  // Desktop : drawer = sidebar toujours visible via CSS.
  // Mobile  : PAS d'ouverture automatique → le FAB est immédiatement visible.
  //           L'utilisateur tape ⚙️ pour accéder aux réglages.

  console.log('%c[Prompteo] 🚀 Prêt', 'color:#ffd600;font-weight:bold;font-size:1.1em');
})();
