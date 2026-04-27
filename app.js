/* ═══════════════════════════════════════════════════════
   Prompteo — Application principale
   Prompteur à reconnaissance vocale (Web Speech API)
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── DOM refs ───
  const drawer        = document.getElementById('drawer');
  const drawerOverlay = document.getElementById('drawer-overlay');
  const drawerHandle  = document.getElementById('drawer-handle');
  const btnSettings   = document.getElementById('btn-settings');
  const scriptInput   = document.getElementById('script-input');
  const btnLoad       = document.getElementById('btn-load');
  const btnReset      = document.getElementById('btn-reset');
  const btnFab        = document.getElementById('btn-fab');
  const fabIconPlay   = document.getElementById('fab-icon-play');
  const fabIconStop   = document.getElementById('fab-icon-stop');
  const fontSlider    = document.getElementById('font-slider');
  const fontSizeValue = document.getElementById('font-size-value');
  const tolSlider     = document.getElementById('tolerance-slider');
  const tolValue      = document.getElementById('tolerance-value');
  const promptText    = document.getElementById('prompt-text');
  const debugHeard    = document.getElementById('debug-heard');
  const micDotTop     = document.getElementById('mic-dot-top');

  // ─── State ───
  let words          = [];   // { el, raw, normalized }
  let currentIndex   = 0;
  let isListening    = false;
  let recognition    = null;
  let fuzzyThreshold = 0.55;

  // Configuration du suivi
  const LOOKAHEAD = 15; // Fenêtre serrée pour une précision maximale
  const MAX_JUMP  = 10; // On ne saute jamais plus d'une ligne d'un coup (sécurité)

  // ════════════════════════════════════════════
  // 1. DRAWER
  // ════════════════════════════════════════════
  function openDrawer() {
    drawer.classList.add('open');
    drawerOverlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
    // Cacher le FAB pendant que le drawer est ouvert
    btnFab.classList.add('hidden');
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('visible');
    document.body.style.overflow = '';
    // Défocaliser la textarea pour éviter que le clavier virtuel se réouvre
    scriptInput.blur();
    // Remettre le FAB visible après l'animation de fermeture (350ms)
    setTimeout(() => btnFab.classList.remove('hidden'), 360);
  }

  if (btnSettings) btnSettings.addEventListener('click', openDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  // ─── Swipe-down pour fermer ───
  let dragY0 = 0, dragY = 0, dragging = false;

  drawerHandle.addEventListener('touchstart', e => {
    dragging = true;
    dragY0 = dragY = e.touches[0].clientY;
    drawer.style.transition = 'none';
  }, { passive: true });

  drawerHandle.addEventListener('touchmove', e => {
    if (!dragging) return;
    dragY = e.touches[0].clientY;
    const d = dragY - dragY0;
    if (d > 0) drawer.style.transform = `translateY(${d}px)`;
  }, { passive: true });

  drawerHandle.addEventListener('touchend', () => {
    dragging = false;
    drawer.style.transition = '';
    if (dragY - dragY0 > 90) {
      drawer.style.transform = '';
      closeDrawer();
    } else {
      drawer.style.transform = '';
    }
  });

  // ════════════════════════════════════════════
  // 2. CHARGEMENT DU SCRIPT
  // ════════════════════════════════════════════
  btnLoad.addEventListener('click', () => {
    const raw = scriptInput.value.trim();
    if (!raw) return;
    // Défocuse la textarea AVANT de fermer pour éviter le re-focus sur iOS
    scriptInput.blur();
    loadScript(raw);
    closeDrawer();
  });

  function normalizeWord(w) {
    return w
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire accents
      .replace(/[^a-z0-9]/g, '');                       // garde alphanum
  }

  function loadScript(text) {
    promptText.innerHTML = '';
    words = [];
    currentIndex = 0;

    // Découpe en phrases
    const sentences = text.split(/(?<=[.!?…;:\n])\s*/);

    sentences.forEach((sentence, si) => {
      if (!sentence.trim()) return;
      sentence.trim().split(/\s+/).forEach(token => {
        const span = document.createElement('span');
        span.className = 'word upcoming';
        span.textContent = token + ' ';
        promptText.appendChild(span);
        words.push({ el: span, raw: token, normalized: normalizeWord(token) });
      });

      if (si < sentences.length - 1) {
        const br = document.createElement('span');
        br.className = 'sentence-break';
        promptText.appendChild(br);
      }
    });

    console.log(`%c[Prompteo] Script chargé — ${words.length} mots`, 'color:#ffd600;font-weight:bold');
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

  // Sur mobile, empêcher les sliders de provoquer un re-focus sur la textarea
  [fontSlider, tolSlider].forEach(slider => {
    slider.addEventListener('touchstart', e => {
      scriptInput.blur();
      e.stopPropagation();
    }, { passive: true });
  });

  // ════════════════════════════════════════════
  // 4. RECONNAISSANCE VOCALE
  // ════════════════════════════════════════════
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Ton navigateur ne supporte pas la Web Speech API.\nUtilise Google Chrome.');
  }

  function setMicState(active) {
    micDotTop.classList.toggle('active', active);
    btnFab.classList.toggle('listening', active);
    fabIconPlay.style.display = active ? 'none'  : 'block';
    fabIconStop.style.display = active ? 'block' : 'none';
  }

  function createRecognition() {
    const rec = new SpeechRecognition();
    rec.continuous      = true;
    rec.interimResults  = true; // RÉACTIVÉ : Pour un défilement mot à mot ultra-fluide
    rec.lang            = 'fr-FR';
    rec.maxAlternatives = 3; // Plus d'alternatives pour mieux comprendre les accents

    rec.onstart = () => {
      console.log('%c[Prompteo] 🎙️ Écoute démarrée', 'color:#4caf50');
      setMicState(true);
      debugHeard.textContent = 'En écoute…';
      debugHeard.style.color = 'var(--accent)';
    };

    rec.onsoundstart  = () => console.log('%c[Prompteo] 🔊 Son',    'color:#888');
    rec.onspeechstart = () => console.log('%c[Prompteo] 🗣️ Parole', 'color:#888');

    rec.onend = () => {
      console.log('%c[Prompteo] 🎙️ Fin de session', 'color:#ff4444');
      setMicState(false);
      // Auto-restart (Chrome coupe à ~60s)
      if (isListening && window.location.protocol !== 'file:') {
        console.log('%c[Prompteo] ↻ Redémarrage…', 'color:#ffd600');
        try { recognition.start(); } catch (_) {}
      }
    };

    rec.onerror = e => {
      console.warn('[Prompteo] Erreur SR:', e.error);
      debugHeard.textContent = `Erreur : ${e.error}`;
      debugHeard.style.color = 'var(--danger)';
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        alert('Accès au micro refusé. Autorise le micro dans les réglages du navigateur.');
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
    let transcript = '';
    let isFinal = false;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
      if (event.results[i].isFinal) isFinal = true;
    }
    
    transcript = transcript.trim();
    if (!transcript) return;

    debugHeard.textContent = transcript;
    debugHeard.style.color = isFinal ? '' : 'var(--text-dim)';

    // On ne traite que si on a au moins un mot de 2+ lettres (évite les bruits parasites)
    const heardWords = transcript.split(/\s+/).map(normalizeWord).filter(w => w.length >= 2);
    
    if (heardWords.length === 0) return;
    matchPhrase(heardWords);
  }

  /*
   * Stratégie "Furthest Match" :
   * On parcourt tous les mots entendus dans le transcript actuel.
   * Pour chaque mot, on cherche s'il existe dans une fenêtre autour de la position actuelle.
   * On avance le prompteur jusqu'au mot le plus lointain trouvé.
   */
  function matchPhrase(heardWords) {
    const searchStart = Math.max(0, currentIndex - 3);
    const searchEnd   = Math.min(currentIndex + LOOKAHEAD, words.length);
    
    let targetIdx = -1;

    // On parcourt les mots entendus de la FIN vers le DÉBUT.
    // Le but est de trouver le mot le plus RECENT et le plus SOLIDE (3+ lettres)
    // pour caler la position du prompteur.
    for (let i = heardWords.length - 1; i >= 0; i--) {
      const heard = heardWords[i];
      if (heard.length < 2) continue;

      let wordBestScore = 0;
      let wordBestIdx   = -1;

      for (let j = searchStart; j < searchEnd; j++) {
        const score = similarity(heard, words[j].normalized);
        if (score > wordBestScore) {
          wordBestScore = score;
          wordBestIdx = j;
        }
      }

      if (wordBestScore >= fuzzyThreshold) {
        // Si on trouve un mot de 3 lettres ou plus, c'est notre ancre parfaite.
        if (heard.length >= 3) {
          targetIdx = wordBestIdx;
          break; // On a trouvé notre tête de lecture, on arrête de chercher
        }
        // Sinon (mot de 2 lettres), on le garde comme cible temporaire 
        // mais on continue de chercher un mot plus solide.
        if (targetIdx === -1) targetIdx = wordBestIdx;
      }
    }

    if (targetIdx !== -1 && targetIdx >= currentIndex) {
      // SÉCURITÉ : Plafond de saut
      const finalIdx = Math.min(targetIdx, currentIndex + MAX_JUMP);
      console.log(`  ✓ Ancrage sur "${words[finalIdx].raw}" (index ${finalIdx})`);
      advanceTo(finalIdx);
    }
  }

  // ════════════════════════════════════════════
  // 7. AVANCEMENT ET SCROLL
  // ════════════════════════════════════════════
  function advanceTo(idx) {
    if (idx < currentIndex) return; // ne jamais reculer

    for (let i = currentIndex; i <= idx; i++) {
      words[i].el.classList.remove('upcoming', 'active');
      words[i].el.classList.add('spoken');
    }
    currentIndex = idx + 1;

    if (currentIndex < words.length) {
      words[currentIndex].el.classList.remove('upcoming');
      words[currentIndex].el.classList.add('active');
      scrollToWord(currentIndex);
    } else {
      console.log('%c[Prompteo] ✅ Script terminé !', 'color:#4caf50;font-weight:bold');
      stopListening();
    }
  }

  function scrollToWord(idx) {
    const el  = words[idx].el;
    const rect = el.getBoundingClientRect();
    const targetY = window.scrollY + rect.top - window.innerHeight * 0.20;
    window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
  }

  // ════════════════════════════════════════════
  // 8. FUZZY — Levenshtein normalisé
  // ════════════════════════════════════════════
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
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
    return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
  }

  // ════════════════════════════════════════════
  // 9. START / STOP
  // ════════════════════════════════════════════
  btnFab.addEventListener('click', () => {
    if (words.length === 0) {
      // Pas de script : ouvrir les réglages
      openDrawer();
      return;
    }
    if (isListening) stopListening();
    else startListening();
  });

  function startListening() {
    recognition = createRecognition();
    isListening = true;
    recognition.start();
    // Met le premier mot en surbrillance
    if (currentIndex < words.length) {
      words[currentIndex].el.classList.remove('upcoming');
      words[currentIndex].el.classList.add('active');
      scrollToWord(currentIndex);
    }
  }

  function stopListening() {
    isListening = false;
    if (recognition) { recognition.abort(); recognition = null; }
    setMicState(false);
  }

  // ════════════════════════════════════════════
  // 10. RESET
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
  // 11. RACCOURCIS CLAVIER (Desktop)
  // ════════════════════════════════════════════
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      btnFab.click();
    }
    if (e.code === 'Escape') closeDrawer();
  });

  console.log('%c[Prompteo] 🚀 Prêt. Appuie sur ⚙️ pour coller ton script.', 'color:#ffd600;font-weight:bold');
})();
