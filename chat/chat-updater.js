// chat-updater.js — Auto-update banner and search toggle

window.Chat = window.Chat || {};
(function() {
  const C = window.Chat;

  C.updateSearchHeaderButton = function() {
    const searchHeaderBtn = C.elements.searchHeaderBtn;
    if (C.state.isSearchEnabled) {
      searchHeaderBtn.classList.add('search-active');
      searchHeaderBtn.title = '联网搜索：开';
    } else {
      searchHeaderBtn.classList.remove('search-active');
      searchHeaderBtn.title = '联网搜索：关';
    }
  };

  C.initSearchToggle = async function() {
    C.state.isSearchEnabled = await window.petAPI.getSearchEnabled();
    const searchToggle = C.elements.searchToggle;
    const searchHeaderBtn = C.elements.searchHeaderBtn;
    searchToggle.checked = C.state.isSearchEnabled;
    C.updateSearchHeaderButton();

    searchToggle.addEventListener('change', async () => {
      C.state.isSearchEnabled = await window.petAPI.toggleSearch();
      searchToggle.checked = C.state.isSearchEnabled;
      C.updateSearchHeaderButton();
    });

    searchHeaderBtn.addEventListener('click', async () => {
      C.state.isSearchEnabled = await window.petAPI.toggleSearch();
      searchToggle.checked = C.state.isSearchEnabled;
      C.updateSearchHeaderButton();
    });
  };

  C.setupUpdateListeners = function() {
    const updateBanner = C.elements.updateBanner;
    const updateBannerText = C.elements.updateBannerText;
    const updateBannerBtn = C.elements.updateBannerBtn;
    const updateBannerDismiss = C.elements.updateBannerDismiss;

    const channels = [
      'update-available',
      'update-not-available',
      'update-download-progress',
      'update-downloaded',
      'update-error'
    ];

    channels.forEach(channel => {
      window.petAPI.onUpdateEvent(channel, (data) => {
        switch (channel) {
          case 'update-available':
            updateBannerText.textContent = `新版本 v${data.version} 可用`;
            updateBannerBtn.textContent = '下载更新';
            updateBannerBtn.onclick = () => {
              updateBannerBtn.textContent = '下载中...';
              updateBannerBtn.disabled = true;
              window.petAPI.downloadUpdate();
            };
            updateBannerDismiss.style.display = 'flex';
            updateBanner.style.display = 'flex';
            break;

          case 'update-download-progress':
            updateBannerText.textContent = `正在下载更新... ${data.percent}%`;
            updateBannerBtn.style.display = 'none';
            updateBannerDismiss.style.display = 'none';
            updateBanner.style.display = 'flex';
            break;

          case 'update-downloaded':
            updateBannerText.textContent = `更新已下载，重启以安装`;
            updateBannerBtn.textContent = '立即重启';
            updateBannerBtn.style.display = 'inline-block';
            updateBannerBtn.disabled = false;
            updateBannerBtn.onclick = () => window.petAPI.quitAndInstall();
            updateBannerDismiss.textContent = '稍后';
            updateBannerDismiss.style.display = 'flex';
            updateBanner.style.display = 'flex';
            break;

          case 'update-error':
            updateBannerText.textContent = `更新失败: ${data.message}`;
            updateBannerBtn.textContent = '重试';
            updateBannerBtn.style.display = 'inline-block';
            updateBannerBtn.disabled = false;
            updateBannerBtn.onclick = () => {
              updateBannerBtn.textContent = '下载中...';
              updateBannerBtn.disabled = true;
              window.petAPI.downloadUpdate();
            };
            updateBannerDismiss.style.display = 'flex';
            updateBanner.style.display = 'flex';
            break;
        }
      });
    });

    updateBannerDismiss.addEventListener('click', () => {
      updateBanner.style.display = 'none';
    });
  };
})();
