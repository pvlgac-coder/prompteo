/* ═══════════════════════════════════════════════════════
   Prompteo — Application principale
   Prompteur à reconnaissance vocale (Web Speech API)
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── DOM refs ───
  const panel          = document.getElementById('control-panel');
  const btnToggle      = document.getElementById('btn-toggle-panel');
  const btnShowPanel   = document.getElementById('btn-show-panel');
  const iconCollapse   = document.getElementById('icon-collapse');
  const iconExpand     = document.getElementById('icon-expand');
  const scriptInput    = document.getElementById('script-input');
  const btnLoad        = document.getElementById('btn-load');
  const btnStart       = document.getElementById('btn-start');
  const btnReset       = document.getElementById('btn-reset');
  const fontSlider     = document.getElementById('font-slider');
  const fontSizeValue  = document.getElementById('font-size-value');
  const tolSlider      = document.getElementById('tolerance-slider');
  const tolValue       = document.getElementById('tolerance-value');
  const promptText     = document.getElementById('prompt-text');
  const debugHeard     = document.getElementById('debug-heard');

  // ─── State ───
  let words          = [];      // tableau de { el, raw, normalized }
  let currentIndex   = 0;       // index du prochain mot attendu
  let isListening    = false;
  let recognition    = null;
  let fuzzyThreshold = 0.55;    // score minimum pour considérer un match (0-1)

  // Micro indicator
  const micDot = document.createElement('div');
  micDot.className = 'mic-indicator';
  document.body.appendChild(micDot);

  // ════════════════════════════════════════════
  // 1. PANNEAU
  // ════════════════════════════════════════════
  function togglePanel() {
    const hidden = panel.classList.toggle('panel-hidden');
    document.body.classList.toggle('panel-collapsed', hidden);
    btnShowPanel.style.display = hidden ? 'block' : 'none';
    iconCollapse.style.display = hidden ? 'none' : 'block';
    iconExpand.style.display   = hidden ? 'block' : 'none';
  }
  btnToggle.addEventListener('click', togglePanel);
  btnShowPanel.addEventListener('click', togglePanel);

  // ════════════════════════════════════════════
  // 2. CHARGEMENT DU SCRIPT
  // ════════════════════════════════════════════
  btnLoad.addEventListener('click', () => {
    const raw = scriptInput.value.trim();
    if (!raw) return;
    loadScript(raw);
  });

  function normalizeWord(w) {
    return w
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // supprime accents
      .replace(/[^a-z0-9]/g, '');                       // garde alphanumériques
  }

  function loadScript(text) {
    promptText.innerHTML = '';
    words = [];
    currentIndex = 0;

    // Découpage en phrases (. ! ? … ; : + retours à la ligne)
    const sentences = text.split(/(?<=[.!?…;:\n])\s*/);

    sentences.forEach((sentence, si) => {
      if (!sentence.trim()) return;

      const tokenList = sentence.trim().split(/\s+/);
      tokenList.forEach((token, wi) => {
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

      // Saut visuel entre phrases
      if (si < sentences.length - 1) {
        const br = document.createElement('span');
        br.className = 'sentence-break';
        promptText.appendChild(br);
      }
    });

    console.log(`%c[Prompteo] Script chargé — ${words.length} mots`, 'color:#ffd600;font-weight:bold');
    btnStart.disabled = false;
    btnReset.disabled = false;
  }

  // ════════════════════════════════════════════
  // 3. TAILLE DE POLICE / TOLÉRANCE
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
    alert('Ton navigateur ne supporte pas la Web Speech API. Utilise Chrome ou Edge.');
  }

  function createRecognition() {
    const rec = new SpeechRecognition();
    rec.continuous   = true;
    rec.interimResults = true;
    rec.lang         = 'fr-FR';
    rec.maxAlternatives = 3;

    rec.onstart = () => {
      console.log('%c[Prompteo] 🎙️ Écoute démarrée', 'color:#4caf50');
      micDot.classList.add('active');
      debugHeard.textContent = "Écoute active... Parlez maintenant.";
      debugHeard.style.color = "var(--accent)";
    };

    rec.onsoundstart = () => {
      console.log('%c[Prompteo] 🔊 Son détecté !', 'color:#ffd600');
    };

    rec.onspeechstart = () => {
      console.log('%c[Prompteo] 🗣️ Parole détectée...', 'color:#ffd600');
    };


    rec.onresult = handleResult;

    return rec;
  }

  // ════════════════════════════════════════════
  // 5. TRAITEMENT DES RÉSULTATS
  // ════════════════════════════════════════════
  function handleResult(event) {
    console.log(`[Prompteo] onresult fired (results length: ${event.results.length})`);
    let transcript = '';
    let isFinal = false;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
      if (event.results[i].isFinal) isFinal = true;
    }

    transcript = transcript.trim();
    if (!transcript) return;

    debugHeard.textContent = transcript;

    const heardWords = transcript.split(/\s+/).map(normalizeWord).filter(w => w.length > 0);

    console.log(
      `%c[SR ${isFinal ? 'FINAL' : 'interim'}]%c "${transcript}"  →  mots: [${heardWords.join(', ')}]`,
      isFinal ? 'color:#4caf50;font-weight:bold' : 'color:#888',
      'color:inherit'
    );

    if (heardWords.length === 0) return;

    // Stratégie : essayer de matcher les mots entendus
    // en avançant dans le script depuis currentIndex
    matchHeardWords(heardWords, isFinal);
  }

  function matchHeardWords(heardWords, isFinal) {
    // Fenêtre de recherche : on cherche dans les N prochains mots du script
    const LOOKAHEAD = 30;
    const searchEnd = Math.min(currentIndex + LOOKAHEAD, words.length);

    // Pour chaque mot entendu, on tente de le trouver dans la fenêtre
    for (const heard of heardWords) {
      if (heard.length < 2) continue; // ignorer mots trop courts

      let bestScore = 0;
      let bestIdx   = -1;

      for (let i = currentIndex; i < searchEnd; i++) {
        const scriptWord = words[i].normalized;
        if (scriptWord.length < 2) continue;

        const score = similarity(heard, scriptWord);

        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      if (bestScore >= fuzzyThreshold && bestIdx >= 0) {
        console.log(
          `  %c✓ match%c  "${heard}" ≈ "${words[bestIdx].raw}" (score: ${bestScore.toFixed(2)}, idx ${bestIdx})`,
          'color:#4caf50;font-weight:bold', 'color:inherit'
        );
        advanceTo(bestIdx);
      } else if (isFinal) {
        console.log(
          `  %c✗ pas de match%c  "${heard}" (meilleur: ${bestScore.toFixed(2)})`,
          'color:#ff4444', 'color:inherit'
        );
      }
    }
  }

  // ════════════════════════════════════════════
  // 6. AVANCEMENT ET SCROLL
  // ════════════════════════════════════════════
  function advanceTo(idx) {
    // Marquer tous les mots jusqu'à idx comme "spoken"
    for (let i = currentIndex; i <= idx; i++) {
      words[i].el.classList.remove('upcoming', 'active');
      words[i].el.classList.add('spoken');
    }

    currentIndex = idx + 1;

    // Marquer le mot courant comme actif
    if (currentIndex < words.length) {
      words[currentIndex].el.classList.remove('upcoming');
      words[currentIndex].el.classList.add('active');

      // Auto-scroll pour garder le mot actif en haut
      scrollToWord(currentIndex);
    }

    // Fin du script ?
    if (currentIndex >= words.length) {
      console.log('%c[Prompteo] ✅ Script terminé !', 'color:#4caf50;font-weight:bold;font-size:1.2em');
      stopListening();
    }
  }

  function scrollToWord(idx) {
    const el = words[idx].el;
    const rect = el.getBoundingClientRect();
    const targetY = window.scrollY + rect.top - window.innerHeight * 0.2;
    window.scrollTo({ top: targetY, behavior: 'smooth' });
  }

  // ════════════════════════════════════════════
  // 7. FUZZY MATCHING — Similarité (Levenshtein normalisé)
  // ════════════════════════════════════════════
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
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
  // 8. START / STOP
  // ════════════════════════════════════════════
  btnStart.addEventListener('click', () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  });

  function startListening() {
    if (words.length === 0) return;

    recognition = createRecognition();
    isListening = true;
    recognition.start();

    btnStart.textContent = '⏹ Stop';
    btnStart.classList.remove('btn-primary');
    btnStart.classList.add('btn-danger');

    // Highlight premier mot
    if (currentIndex < words.length) {
      words[currentIndex].el.classList.remove('upcoming');
      words[currentIndex].el.classList.add('active');
    }
  }

  function stopListening() {
    isListening = false;
    if (recognition) {
      recognition.abort();
      recognition = null;
    }
    micDot.classList.remove('active');
    btnStart.textContent = '▶ Start';
    btnStart.classList.remove('btn-danger');
    btnStart.classList.add('btn-primary');
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
    console.log('%c[Prompteo] ↻ Reset', 'color:#ffd600');
  });

  // ════════════════════════════════════════════
  // 10. RACCOURCIS CLAVIER
  // ════════════════════════════════════════════
  document.addEventListener('keydown', (e) => {
    // Espace (hors textarea) = Start/Stop
    if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      btnStart.click();
    }
    // Escape = toggle panel
    if (e.code === 'Escape') {
      togglePanel();
    }
  });

  console.log('%c[Prompteo] 🚀 Prêt', 'color:#ffd600;font-weight:bold;font-size:1.1em');
})();
