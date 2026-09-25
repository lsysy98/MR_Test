(function () {
  'use strict';
  var button = document.getElementById('homeInstallBtn');
  var mobile = window.matchMedia('(max-width: 900px)');
  var standalone = window.matchMedia('(display-mode: standalone)');
  var fullscreen = window.matchMedia('(display-mode: fullscreen)');
  var pendingPrompt = null;
  var installed = false;
  var workerStarted = false;

  function isInstalled() {
    return installed || standalone.matches || fullscreen.matches || navigator.standalone === true;
  }
  function refresh() {
    button.hidden = isInstalled() || !mobile.matches;
    if (!button.hidden && !workerStarted && window.isSecureContext && 'serviceWorker' in navigator) {
      workerStarted = true;
      // Reuse the notification worker without requesting notification permission.
      navigator.serviceWorker.register('/sw.js').catch(function () { workerStarted = false; });
    }
  }
  function showInstructions() {
    var agent = navigator.userAgent;
    var ios = /iPad|iPhone|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var inApp = /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|; wv\)/i.test(agent);
    var message;
    if (inApp) {
      message = ios
        ? '현재 앱의 메뉴에서 Safari로 열어주세요. Safari의 공유 메뉴에서 홈 화면에 추가 → 추가를 누르면 됩니다.'
        : '현재 앱의 메뉴에서 Chrome 또는 기본 브라우저로 열어주세요. 홈 화면에 추가 버튼을 다시 누르면 됩니다.';
    } else if (ios) {
      message = 'Safari의 공유 버튼을 누른 뒤 홈 화면에 추가 → 추가를 눌러주세요. 공유 버튼이 안 보이면 브라우저의 더 보기 메뉴를 열어주세요.';
    } else {
      message = '브라우저 메뉴에서 홈 화면에 추가 또는 앱 설치를 선택해주세요. 해당 메뉴가 없으면 Chrome 또는 기본 브라우저로 열어주세요.';
    }
    showNotice(message);
  }
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    pendingPrompt = event;
    refresh();
  });
  window.addEventListener('appinstalled', function () {
    installed = true;
    pendingPrompt = null;
    refresh();
  });
  button.addEventListener('click', async function () {
    if (isInstalled()) { refresh(); return; }
    if (!pendingPrompt) { showInstructions(); return; }
    var prompt = pendingPrompt;
    pendingPrompt = null;
    button.disabled = true;
    try {
      // The browser prompt must run directly from the user's tap.
      await prompt.prompt();
      var choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') installed = true;
    } catch (_) {
      showInstructions();
    } finally {
      button.disabled = false;
      refresh();
    }
  });
  [mobile, standalone, fullscreen].forEach(function (query) { query.addEventListener('change', refresh); });
  window.addEventListener('pageshow', refresh);
  refresh();
})();
