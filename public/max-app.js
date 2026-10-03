if (location.pathname === '/miniapp' || location.pathname.startsWith('/miniapp/')) {
  document.documentElement.dataset.maxMiniapp = 'true';

  const script = document.createElement('script');
  script.src = 'https://st.max.ru/js/max-web-app.js';
  script.async = true;
  script.addEventListener('load', () => {
    const maxApp = window.WebApp;
    if (!maxApp) return;
    maxApp.ready?.();
    maxApp.expand?.();
    maxApp.setHeaderColor?.('#FBF6EE');
    maxApp.setBackgroundColor?.('#FBF6EE');
    if (location.pathname === '/miniapp') {
      maxApp.BackButton?.hide?.();
    } else if (typeof maxApp.BackButton?.show === 'function') {
      maxApp.BackButton.show();
      maxApp.BackButton.onClick?.(() => {
        if (history.length > 1) history.back();
        else location.assign('/miniapp');
      });
    }
  }, { once: true });
  script.addEventListener('error', () => {
    console.warn('MAX Mini App SDK could not be loaded.');
  }, { once: true });
  document.head.append(script);
}
