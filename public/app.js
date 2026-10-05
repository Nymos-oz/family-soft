const appRoot = document.querySelector('#app');
const cartKey = 'family-soft-cart-v1';
const favoritesKey = 'family-soft-favorites-v1';
const themePreferenceKey = 'family-soft-theme-v1';
const themeOptions = ['auto', 'light', 'evening', 'dark'];
const savedCart = readCart();
const savedFavorites = readFavorites();
let themePreference = readThemePreference();
let shopConfig;
let toastTimer;
let currentFaq = [];

function readThemePreference() {
  try {
    const value = localStorage.getItem(themePreferenceKey);
    return themeOptions.includes(value) ? value : 'auto';
  } catch (error) {
    console.warn('Theme preference could not be loaded:', error.message);
    return 'auto';
  }
}

function themeForLocalTime() {
  const hour = new Date().getHours();
  if (hour >= 7 && hour < 17) return 'light';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'dark';
}

function applyTheme() {
  const theme = themePreference === 'auto' ? themeForLocalTime() : themePreference;
  const forcedHero = new URLSearchParams(location.search).get('hero');
  document.documentElement.dataset.theme = theme;
  if (forcedHero !== 'day' && forcedHero !== 'night') {
    document.documentElement.dataset.hero = theme === 'light' ? 'day' : theme === 'evening' ? 'evening' : 'night';
  }
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme === 'dark' ? '#171923' : theme === 'evening' ? '#f2e6dc' : '#FBF6EE';
  const colorScheme = document.querySelector('meta[name="color-scheme"]');
  if (colorScheme) colorScheme.content = theme === 'dark' ? 'dark' : 'light';
}

function readCart() {
  try {
    const value = JSON.parse(localStorage.getItem(cartKey) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(item => Number.isInteger(item.productId) && Number.isInteger(item.quantity) && item.quantity > 0)
      .map(item => ({ productId: item.productId, quantity: Math.min(20, item.quantity), variant: String(item.variant || '').slice(0, 80) }));
  } catch {
    return [];
  }
}

function readFavorites() {
  try {
    const values = JSON.parse(localStorage.getItem(favoritesKey) || '[]');
    return Array.isArray(values) ? [...new Set(values.filter(Number.isSafeInteger))] : [];
  } catch { return []; }
}

function saveFavorites() {
  localStorage.setItem(favoritesKey, JSON.stringify(savedFavorites));
}

function trackGoal(name) {
  if (typeof window.ym === 'function' && /^\d+$/.test(shopConfig?.metrikaId || '')) {
    window.ym(Number(shopConfig.metrikaId), 'reachGoal', name);
  }
}

function loadMetrika() {
  if (!/^\d+$/.test(shopConfig?.metrikaId || '') || window.ym) return;
  const id = Number(shopConfig.metrikaId);
  window.ym = function (...args) {
    (window.ym.a = window.ym.a || []).push(args);
  };
  window.ym.l = Date.now();
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://mc.yandex.ru/metrika/tag.js';
  script.addEventListener('error', () => console.warn('Yandex Metrika did not load.'), { once: true });
  document.head.append(script);
  window.ym(id, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
}

function saveCart() {
  localStorage.setItem(cartKey, JSON.stringify(savedCart));
  document.querySelectorAll('[data-cart-count]').forEach(node => {
    node.textContent = String(savedCart.reduce((sum, item) => sum + item.quantity, 0));
  });
}

function money(value) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function imageUrl(value, fallback = '/img/hero-day.jpg') {
  return typeof value === 'string' && (value.startsWith('/img/') || value.startsWith('/uploads/')) ? value : fallback;
}

function phoneHref(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) return `tel:+7${digits.slice(1)}`;
  return 'tel:+79018267781';
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  let body = {};
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) body = await response.json();
  if (!response.ok) throw new Error(body.error || `Не удалось загрузить данные (${response.status}).`);
  return body;
}

async function adminApi(url, options = {}) {
  const csrf = sessionStorage.getItem('family-soft-admin-csrf') || '';
  return api(url, {
    ...options,
    headers: { ...(options.headers || {}), 'X-CSRF-Token': csrf }
  });
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function header() {
  const total = savedCart.reduce((sum, item) => sum + item.quantity, 0);
  return `<div class="topbar"><div class="container topbar-inner"><span>Нежность · Комфорт · Забота &nbsp; · &nbsp; Ручная работа с любовью</span>
    <label class="theme-control" for="theme-select"><span>Тема</span><select id="theme-select" aria-label="Тема оформления">
      <option value="auto" ${themePreference === 'auto' ? 'selected' : ''}>Авто · местное время</option>
      <option value="light" ${themePreference === 'light' ? 'selected' : ''}>Светлая</option>
      <option value="evening" ${themePreference === 'evening' ? 'selected' : ''}>Вечерняя</option>
      <option value="dark" ${themePreference === 'dark' ? 'selected' : ''}>Тёмная</option>
    </select></label></div></div>
    <header class="site-header"><div class="container header-inner">
      <a class="brand" href="/" aria-label="Family Soft — на главную">
        <img src="/img/logo.jpg" width="50" height="50" alt="Логотип Family Soft">
        <span><strong>Family Soft</strong><small>Домашний текстиль</small></span>
      </a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="main-nav" aria-label="Открыть меню">☰</button>
      <nav class="main-nav" id="main-nav" aria-label="Главная навигация">
        <a href="/catalog">Каталог</a><a href="/category/plaids">Пледы</a><a href="/size-guide">Подбор размера</a><a href="/custom">На заказ</a>
        <a href="/blog">Блог</a><a href="/faq">Помощь</a>
      </nav>
      <div class="header-actions">
        <a class="phone-link" href="${phoneHref(shopConfig?.phone)}" aria-label="Позвонить в Family Soft">☎</a>
        <a class="account-link" href="/account" aria-label="Личный кабинет">♙</a>
        <a class="favorites-link" href="/favorites" aria-label="Избранное">♡</a>
        <a class="cart-link" href="/cart" aria-label="Корзина">🛍<span class="count-badge" data-cart-count>${total}</span></a>
      </div>
    </div></header>`;
}

function footer() {
  const phone = escapeHtml(shopConfig?.phone || '+7 (901) 826-77-81');
  return `<footer class="site-footer"><div class="container">
    <div class="footer-grid">
      <div><img class="footer-logo" src="/img/logo.jpg" width="100" height="100" alt="Family Soft">
        <h3>Family Soft</h3><p>Домашний текстиль<br>Нежность · Комфорт · Забота</p>
        <img class="label-image" src="/img/label.jpg" alt="Ручная работа. Сделано с теплом и любовью">
      </div>
      <div class="footer-links"><strong>Покупателям</strong><a href="/catalog">Каталог</a><a href="/size-guide">Подбор размера</a><a href="/delivery">Доставка и оплата</a><a href="/faq">Частые вопросы</a><a href="/safe-shopping">Безопасные покупки</a><a href="/contacts">Контакты</a></div>
      <div class="footer-links"><strong>Связаться с нами</strong><a href="${phoneHref(phone)}">${phone}</a><a href="/contacts">Написать нам</a><a href="https://max.ru/se14501009_bot" target="_blank" rel="noopener noreferrer">Написать в MAX</a><a href="/about">О Family Soft</a><a href="/privacy">Политика конфиденциальности</a><a href="/offer">Публичная оферта</a></div>
    </div>
    <div class="footer-legal">Официальный сайт Family Soft: family-soft.ru. Мы никогда не просим коды из SMS и писем, данные карт и оплату вне сайта.</div>
  </div></footer>`;
}

function shell(content, title = 'Домашний текстиль') {
  document.title = `${title} | Family Soft`;
  appRoot.innerHTML = `${header()}<main id="main">${content}</main>${footer()}`;
  bindShared();
  registerServiceWorker();
  showCookieBanner();
}

function bindShared() {
  document.querySelector('#theme-select')?.addEventListener('change', event => {
    themePreference = event.currentTarget.value;
    applyTheme();
    try {
      localStorage.setItem(themePreferenceKey, themePreference);
    } catch (error) {
      console.warn('Theme preference could not be saved:', error.message);
      showToast('Тема изменена, но сохранить её в этом браузере не удалось.');
    }
  });
  const toggle = document.querySelector('.menu-toggle');
  toggle?.addEventListener('click', () => {
    const nav = document.querySelector('.main-nav');
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  });
  document.querySelectorAll('.main-nav a').forEach(link => link.addEventListener('click', () => {
    document.querySelector('.main-nav')?.classList.remove('open');
  }));
}

function showCookieBanner() {
  const choice = localStorage.getItem('family-soft-cookie-choice');
  if (choice) {
    if (choice === 'analytics') loadMetrika();
    return;
  }
  const banner = document.createElement('aside');
  banner.className = 'cookie-banner';
  banner.setAttribute('aria-label', 'Настройки cookie');
  banner.innerHTML = `<strong>Настройки cookie</strong><p>Необходимые cookie помогают корзине и оформлению заказа. Аналитические cookie можно разрешить отдельно.</p>
    <div class="cookie-actions"><button type="button" data-cookie="necessary">Только необходимые</button><button type="button" class="secondary" data-cookie="analytics">Разрешить аналитику</button></div>`;
  document.body.append(banner);
  banner.querySelectorAll('[data-cookie]').forEach(button => button.addEventListener('click', () => {
    localStorage.setItem('family-soft-cookie-choice', button.dataset.cookie);
    banner.remove();
    if (button.dataset.cookie === 'analytics') loadMetrika();
  }));
}

function productCard(product) {
  const photo = imageUrl(product.images?.[0]);
  const availability = product.in_stock && product.stock_qty > 0
    ? product.stock_qty <= 3 ? `<span class="stock low">Осталось мало: ${product.stock_qty} шт.</span>` : `<span class="stock">В наличии: ${product.stock_qty} шт.</span>`
    : '<span class="stock out">Нет в наличии</span>';
  return `<article class="product-card">
    <a class="product-photo" href="/product/${product.id}" aria-label="Открыть ${escapeHtml(product.name)}"><img src="${escapeHtml(photo)}" alt="${escapeHtml(product.name)}" loading="lazy" width="520" height="440"></a>
    <div class="product-info"><h3><a href="/product/${product.id}">${escapeHtml(product.name)}</a></h3>
      <p>${escapeHtml(product.material || '')}</p>${availability}
      <div class="product-bottom"><span class="price">${money(product.price)}</span>
        ${product.in_stock && product.stock_qty > 0
          ? `<button class="small-button" type="button" data-add="${product.id}">В корзину</button>`
          : `<a class="small-button button secondary" href="/product/${product.id}">Подробнее</a>`}
      </div>
    </div>
  </article>`;
}

function bindAddToCart(products = []) {
  document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => {
    const id = Number(button.dataset.add);
    const item = savedCart.find(row => row.productId === id);
    const product = products.find(row => row.id === id);
    if (item) {
      if (product && item.quantity >= product.stock_qty) return showToast('В корзине уже всё доступное количество этого товара.');
      item.quantity += 1;
    } else savedCart.push({ productId: id, quantity: 1, variant: '' });
    saveCart();
    trackGoal('add_to_cart');
    showToast('Добавили в корзину — пусть дома станет уютнее 💛');
  }));
}

function cardGrid(products) {
  return products.length ? `<div class="product-grid">${products.map(productCard).join('')}</div>`
    : `<div class="empty-state"><img src="/img/logo.jpg" alt=""><h3>Пока ничего не нашлось</h3><p>Попробуйте изменить запрос или фильтры.</p></div>`;
}

async function loadProducts(params = '') {
  return api(`/api/products${params ? `?${params}` : ''}`);
}

async function renderHome() {
  const [categories, result] = await Promise.all([api('/api/categories'), loadProducts()]);
  const hero = `<section class="hero"><div class="container"><div class="hero-content">
    <p class="eyebrow">Нежность · Комфорт · Забота</p>
    <h1>Домашний текстиль,<br>сделанный с любовью</h1>
    <p>Мягкие ткани, уютные цвета и вещи, которые помогают дому стать ещё теплее.</p>
    <div class="hero-actions"><a class="button" href="/catalog">Смотреть каталог</a><a class="button secondary" href="/custom">Работа на заказ</a></div>
  </div></div></section>
  <section class="section container"><div class="section-heading"><div><h2>Найдите свой уют</h2><p>Выберите то, что согреет именно ваш дом.</p></div><a href="/catalog">Весь каталог →</a></div>
    <div class="category-grid">${categories.filter(item => item.slug !== 'custom').map(category =>
      `<a class="category-card" href="/category/${encodeURIComponent(category.slug)}"><img class="category-photo" src="${escapeHtml(imageUrl(category.image))}" alt="" loading="lazy" width="520" height="440"><span>${escapeHtml(category.name)}</span></a>`
    ).join('')}
    <a class="category-card" href="/custom"><img class="category-photo" src="/img/label.jpg" alt="" loading="lazy" width="520" height="440"><span>Работа на заказ</span></a></div>
  </section>
  <section class="section section-tint"><div class="container"><div class="section-heading"><div><h2>Уютные любимчики</h2><p>Несколько вещей, с которых можно начать знакомство.</p></div></div>${cardGrid(result.products.slice(0, 8))}</div></section>
  <section class="section container"><div class="section-heading"><div><h2>Почему Family Soft</h2><p>Текстиль, к которому хочется возвращаться.</p></div></div>
    <div class="feature-grid"><article class="feature"><span aria-hidden="true">🧵</span><h3>Ручная работа</h3><p>Шьём небольшими партиями, бережно проверяем каждую деталь.</p></article>
    <article class="feature"><span aria-hidden="true">☁️</span><h3>Мягкий уют</h3><p>Подбираем комфортные фактуры и спокойные оттенки для дома.</p></article>
    <article class="feature"><span aria-hidden="true">💝</span><h3>Подарок с заботой</h3><p>Добавьте упаковку и открытку с вашими словами при оформлении.</p></article></div>
  </section>
  <section class="section container"><div class="custom-banner"><div><h2>Есть идея для своего изделия?</h2><p>Расскажите нам о размере, ткани и цветах — обсудим ваш индивидуальный заказ.</p></div><a class="button" href="/custom">Обсудить заказ</a></div></section>`;
  shell(hero, 'Домашний текстиль ручной работы');
  bindAddToCart(result.products);
}

async function renderCatalog(categorySlug = '') {
  const categories = await api('/api/categories');
  shell(`<section class="page-main container"><div class="breadcrumbs"><a href="/">Главная</a> / Каталог</div>
    <div class="page-intro"><h1>${categorySlug ? escapeHtml(categories.find(item => item.slug === categorySlug)?.name || 'Каталог') : 'Каталог текстиля'}</h1><p>Домашний текстиль, сшитый с нежностью и вниманием к деталям.</p></div>
    <form class="catalog-tools" id="catalog-filter">
      <label class="visually-hidden" for="search">Поиск товаров</label><input id="search" name="q" placeholder="Поиск по каталогу…" autocomplete="off">
      <label class="visually-hidden" for="category">Категория</label><select id="category" name="category"><option value="">Все категории</option>${categories.filter(item => item.slug !== 'custom').map(item => `<option value="${escapeHtml(item.slug)}" ${item.slug === categorySlug ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select>
      <label class="visually-hidden" for="min-price">Цена от, ₽</label><input id="min-price" name="min" type="number" min="0" placeholder="Цена от">
      <label class="visually-hidden" for="max-price">Цена до, ₽</label><input id="max-price" name="max" type="number" min="0" placeholder="Цена до">
      <label class="visually-hidden" for="sort">Сортировка</label><select id="sort" name="sort"><option value="new">Сначала новинки</option><option value="price_asc">Сначала дешевле</option><option value="price_desc">Сначала дороже</option></select>
      <label class="check-row"><input type="checkbox" name="stock" value="1"> В наличии</label>
    </form><div id="catalog-results" aria-live="polite"><div class="loading">Загружаем товары…</div></div>
  </section>`, 'Каталог');

  const form = document.querySelector('#catalog-filter');
  const results = document.querySelector('#catalog-results');
  let products = [];
  let page = 1;
  let total = 0;
  let timer;
  async function fetchPage(reset = true) {
    if (reset) { page = 1; products = []; results.innerHTML = '<div class="loading">Загружаем товары…</div>'; }
    const params = new URLSearchParams(new FormData(form));
    if (!params.get('category')) params.delete('category');
    if (!params.get('min')) params.delete('min');
    if (!params.get('max')) params.delete('max');
    if (!params.get('q')) params.delete('q');
    if (!params.get('stock')) params.delete('stock');
    if (categorySlug && !params.get('category')) params.set('category', categorySlug);
    params.set('page', String(page));
    const response = await loadProducts(params.toString());
    total = response.total;
    products = reset ? response.products : [...products, ...response.products];
    results.innerHTML = `${cardGrid(products)}${products.length < total ? '<div class="load-more"><button class="secondary" id="load-more" type="button">Показать ещё</button></div>' : ''}`;
    bindAddToCart(response.products);
    document.querySelector('#load-more')?.addEventListener('click', () => { page += 1; fetchPage(false).catch(showToast); });
    history.replaceState(null, '', `/catalog${params.get('category') ? `?category=${encodeURIComponent(params.get('category'))}` : ''}`);
  }
  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => fetchPage().catch(error => { results.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`; }), 240);
  });
  form.addEventListener('change', () => fetchPage().catch(error => { results.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`; }));
  await fetchPage();
}

async function renderProduct(id) {
  const product = await api(`/api/products/${encodeURIComponent(id)}`);
  const reviews = await api(`/api/products/${encodeURIComponent(id)}/reviews`);
  const images = Array.isArray(product.images) ? product.images : [];
  const stock = product.in_stock && product.stock_qty > 0
    ? product.stock_qty <= 3 ? `<p class="stock low">Осталось мало — ${product.stock_qty} шт.</p>` : `<p class="stock">В наличии: ${product.stock_qty} шт.</p>`
    : '<p class="stock out">Сейчас нет в наличии</p>';
  shell(`<section class="page-main container"><div class="breadcrumbs"><a href="/">Главная</a> / <a href="/catalog">Каталог</a> / ${escapeHtml(product.category_name)}</div>
    <div class="product-detail"><div><img class="product-main-image" src="${escapeHtml(imageUrl(images[0]))}" alt="${escapeHtml(product.name)}" width="900" height="800" fetchpriority="high"></div>
      <div><p class="product-meta">${escapeHtml(product.category_name)}</p><h1>${escapeHtml(product.name)}</h1><p>${escapeHtml(product.description)}</p>${stock}
        <p class="price">${money(product.price)}</p>
        <dl class="product-details-list"><div><dt>Материал</dt><dd>${escapeHtml(product.material)}</dd></div><div><dt>Размеры</dt><dd>${escapeHtml(product.dimensions)}</dd></div><div><dt>Уход</dt><dd>${escapeHtml(product.care)}</dd></div></dl>
        ${product.variants?.length ? `<label for="variant">Вариант<select id="variant">${product.variants.map(value => `<option>${escapeHtml(value)}</option>`).join('')}</select></label>` : ''}
        <div class="buy-row">${product.in_stock && product.stock_qty > 0
          ? `<label for="product-quantity">Количество<input id="product-quantity" type="number" min="1" max="${Math.min(20, product.stock_qty)}" value="1"></label><button id="product-add" type="button">В корзину</button>`
          : '<a class="button secondary" href="/contacts">Уточнить поступление</a>'}
          <button class="secondary" id="favorite-toggle" type="button">${savedFavorites.includes(product.id) ? 'Убрать из избранного' : 'В избранное ♡'}</button>
          <button class="secondary" id="share-product" type="button">Поделиться</button></div>
        <p class="notice">Перед оплатой проверьте реквизиты на странице заказа. Мы не запрашиваем коды из SMS и данные карты.</p>
      </div></div>
      <section class="section reviews-section"><h2>Отзывы покупателей</h2>${reviews.length ? `<div class="review-list">${reviews.map(review => `<article class="review-card">
        <div class="review-heading"><strong>${escapeHtml(review.author)}</strong><span aria-label="Оценка ${review.rating} из 5">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</span></div>
        <p>${escapeHtml(review.body)}</p><time>${escapeHtml(review.created_at)}</time></article>`).join('')}</div>`
      : '<p class="product-meta">Пока нет опубликованных отзывов. Отзыв о покупке можно оставить в личном кабинете после оплаты заказа.</p>'}</section>
    </section>
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Product', name: product.name, description: product.description,
      image: images.length ? images.map(imageUrl) : ['/img/hero-day.jpg'], sku: String(product.id),
      offers: { '@type': 'Offer', priceCurrency: 'RUB', price: product.price, availability: product.stock_qty > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' }
    }).replace(/</g, '\\u003c')}</script>`, product.name);
  document.querySelector('#product-add')?.addEventListener('click', () => {
    const quantity = Math.max(1, Math.min(Number(document.querySelector('#product-quantity').value) || 1, product.stock_qty, 20));
    const variant = document.querySelector('#variant')?.value || '';
    const existing = savedCart.find(item => item.productId === product.id && item.variant === variant);
    if (existing) existing.quantity = Math.min(product.stock_qty, 20, existing.quantity + quantity);
    else savedCart.push({ productId: product.id, quantity, variant });
    saveCart();
    showToast('Товар добавлен в корзину.');
  });
  document.querySelector('#favorite-toggle')?.addEventListener('click', event => {
    const index = savedFavorites.indexOf(product.id);
    if (index >= 0) {
      savedFavorites.splice(index, 1);
      event.currentTarget.textContent = 'В избранное ♡';
      showToast('Товар удалён из избранного.');
    } else {
      savedFavorites.push(product.id);
      event.currentTarget.textContent = 'Убрать из избранного';
      showToast('Товар сохранён в избранном.');
    }
    saveFavorites();
  });
  document.querySelector('#share-product')?.addEventListener('click', async () => {
    const shareData = { title: product.name, text: 'Family Soft — домашний текстиль', url: location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else { await navigator.clipboard.writeText(location.href); showToast('Ссылка на товар скопирована.'); }
    } catch (error) {
      if (error.name !== 'AbortError') showToast('Не удалось поделиться ссылкой. Скопируйте адрес страницы.');
    }
  });
}

async function renderCart() {
  if (!savedCart.length) {
    shell(`<section class="page-main container"><div class="empty-state"><img src="/img/logo.jpg" alt="Family Soft"><h1>В корзине пока уютно пусто</h1><p>Загляните в каталог — возможно, там уже ждёт ваш новый любимый плед.</p><a class="button" href="/catalog">Перейти в каталог</a></div></section>`, 'Корзина');
    return;
  }
  const products = new Map(await Promise.all([...new Set(savedCart.map(item => item.productId))]
    .map(async id => { const product = await api(`/api/products/${id}`); return [product.id, product]; })));
  const unavailable = savedCart.filter(item => !products.has(item.productId));
  unavailable.forEach(item => savedCart.splice(savedCart.indexOf(item), 1));
  const rows = savedCart.map(item => {
    const product = products.get(item.productId);
    if (!product) return '';
    return `<article class="cart-item" data-cart-row="${product.id}" data-variant="${escapeHtml(item.variant)}">
      <img src="${escapeHtml(imageUrl(product.images?.[0]))}" alt="${escapeHtml(product.name)}" width="92" height="82">
      <div><h3><a href="/product/${product.id}">${escapeHtml(product.name)}</a></h3><p>${escapeHtml(item.variant || product.material)} · ${money(product.price)} за шт.</p>
        <p class="${product.stock_qty < item.quantity ? 'stock out' : product.stock_qty <= 3 ? 'stock low' : 'stock'}">${product.stock_qty < item.quantity ? `Доступно ${product.stock_qty} шт. — измените количество` : product.stock_qty > 0 ? `В наличии: ${product.stock_qty} шт.` : 'Нет в наличии'}</p></div>
      <div class="cart-controls"><label class="visually-hidden" for="qty-${product.id}-${escapeHtml(item.variant)}">Количество ${escapeHtml(product.name)}</label><input id="qty-${product.id}-${escapeHtml(item.variant)}" type="number" min="1" max="20" value="${item.quantity}" data-quantity="${product.id}" data-variant="${escapeHtml(item.variant)}">
        <button class="text-button" type="button" aria-label="Удалить ${escapeHtml(product.name)} из корзины" data-remove="${product.id}" data-variant="${escapeHtml(item.variant)}">Удалить</button></div>
    </article>`;
  }).join('');
  shell(`<section class="page-main container"><div class="breadcrumbs"><a href="/">Главная</a> / Корзина</div><h1>Ваша корзина</h1>
    <div class="cart-table">${rows}</div>
    <div class="gift-options"><strong>Добавить немного заботы</strong><label class="check-row"><input id="gift-wrap" type="checkbox"> Подарочная упаковка — ${money(shopConfig.giftWrapPrice)}</label>
      <label for="gift-card">Текст открытки (до 300 символов)<textarea id="gift-card" maxlength="300" placeholder="Напишите несколько тёплых слов"></textarea></label></div>
    <div class="form-grid promo-form"><label for="promo">Промокод<input id="promo" maxlength="40" autocomplete="off" placeholder="Если у вас есть промокод"></label><div class="align-end"><button class="secondary" type="button" id="apply-promo">Проверить промокод</button></div></div>
    <p id="promo-result" class="error-message" aria-live="polite"></p>
    <div class="totals"><div class="total-row"><span>Сумма товаров</span><strong id="cart-subtotal">—</strong></div>
      <div class="total-row"><span>Доставка</span><span>Рассчитывается при оформлении</span></div>
      <div class="total-row grand"><span>Итого без доставки</span><strong id="cart-total">—</strong></div>
      <a class="button" href="/checkout">Перейти к оформлению</a></div></section>`, 'Корзина');
  const updateEstimates = () => {
    let subtotal = 0;
    for (const item of savedCart) subtotal += (products.get(item.productId)?.price || 0) * item.quantity;
    document.querySelector('#cart-subtotal').textContent = money(subtotal);
    document.querySelector('#cart-total').textContent = money(subtotal + (document.querySelector('#gift-wrap').checked ? shopConfig.giftWrapPrice : 0));
  };
  document.querySelectorAll('[data-quantity]').forEach(input => input.addEventListener('change', () => {
    const row = savedCart.find(item => item.productId === Number(input.dataset.quantity) && item.variant === input.dataset.variant);
    if (row) row.quantity = Math.max(1, Math.min(20, Number(input.value) || 1));
    saveCart();
    updateEstimates();
  }));
  document.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
    const index = savedCart.findIndex(item => item.productId === Number(button.dataset.remove) && item.variant === button.dataset.variant);
    if (index >= 0) savedCart.splice(index, 1);
    saveCart();
    renderCart().catch(showToast);
  }));
  document.querySelector('#gift-wrap').addEventListener('change', updateEstimates);
  document.querySelector('#apply-promo').addEventListener('click', async () => {
    const result = document.querySelector('#promo-result');
    result.textContent = '';
    try {
      const checked = await api('/api/promo/check', {
        method: 'POST',
        body: JSON.stringify({ items: savedCart, promoCode: document.querySelector('#promo').value })
      });
      result.textContent = `Промокод принят: скидка ${money(checked.discount)}. Итог будет пересчитан при оформлении.`;
      result.classList.add('success');
    } catch (error) {
      result.textContent = error.message;
      result.classList.remove('success');
    }
  });
  updateEstimates();
}

async function renderCheckout() {
  const accountSession = await api('/api/account/session');
  const accountProfile = accountSession.authenticated ? (await api('/api/account')).profile : null;
  const orderAvailable = shopConfig.orderAvailable ?? shopConfig.paymentAvailable;
  const paymentAvailable = shopConfig.paymentAvailable;
  shell(`<section class="page-main container"><div class="breadcrumbs"><a href="/">Главная</a> / <a href="/cart">Корзина</a> / Оформление</div>
    <div class="form-card"><h1>Оформление заказа</h1><p>Мы отправим подтверждение и ссылку на статус заказа на указанный email.</p>
      ${!paymentAvailable && orderAvailable ? '<p class="notice">Заказ можно оформить без онлайн-оплаты. Продавец свяжется с вами, чтобы согласовать оплату. Не переводите деньги до получения инструкций.</p>' : ''}
      ${!orderAvailable ? '<p class="notice">Приём заказов временно недоступен. Свяжитесь с магазином.</p>' : ''}
      <form id="checkout-form" class="form-stack">
        <div class="form-grid"><label>Имя<input name="name" autocomplete="name" value="${escapeHtml(accountProfile?.name || '')}" required maxlength="100"></label><label>Телефон<input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${escapeHtml(accountProfile?.latest_order_phone || '')}" placeholder="+7 900 000-00-00" required></label></div>
        <label>Email — пришлём чек и статус заказа<input name="email" type="email" autocomplete="email" value="${escapeHtml(accountProfile?.email || '')}" required maxlength="254"></label>
        <label>Получение<select name="deliveryType"><option value="delivery">Доставка</option><option value="pickup">Самовывоз</option></select></label>
        <label id="address-field">Адрес доставки<textarea name="address" autocomplete="street-address" minlength="8" maxlength="300" required></textarea></label>
        <label>Комментарий к заказу<textarea name="comment" maxlength="500"></textarea></label>
        <label>Промокод<input name="promoCode" maxlength="40" autocomplete="off"></label>
        <label class="check-row"><input type="checkbox" name="giftWrap"> Подарочная упаковка (${money(shopConfig.giftWrapPrice)})</label>
        <label>Текст открытки (до 300 символов)<textarea name="giftCardText" maxlength="300"></textarea></label>
        <label class="check-row"><input type="checkbox" name="consentData" required> Согласен(на) с <a href="/privacy">Политикой конфиденциальности</a></label>
        <label class="check-row"><input type="checkbox" name="consentOffer" required> Принимаю условия <a href="/offer">публичной оферты</a></label>
        ${paymentAvailable ? '<p class="notice">Переводите только на реквизиты со страницы заказа. Мы не просим переводить деньги на другие номера и карты, в чатах и звонках.</p>' : ''}
        <p id="checkout-error" class="error-message" role="alert"></p>
        <button type="submit" ${!orderAvailable ? 'disabled' : ''}>${paymentAvailable && shopConfig.paymentMode === 'yookassa' ? 'Оплатить через СБП' : 'Оформить заказ'}</button>
        <p>Есть вопросы? <a href="/faq">Смотрите частые вопросы</a> или <a href="${phoneHref(shopConfig.phone)}">${escapeHtml(shopConfig.phone)}</a>.</p>
      </form></div></section>`, 'Оформление заказа');

  const form = document.querySelector('#checkout-form');
  const delivery = form.elements.deliveryType;
  function updateAddress() {
    const visible = delivery.value === 'delivery';
    document.querySelector('#address-field').hidden = !visible;
    form.elements.address.required = visible;
  }
  delivery.addEventListener('change', updateAddress);
  updateAddress();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const error = document.querySelector('#checkout-error');
    error.textContent = '';
    if (!savedCart.length) { error.textContent = 'Корзина пуста.'; return; }
    const data = new FormData(form);
    const phone = String(data.get('phone') || '').replace(/[^\d+]/g, '');
    const normalizedPhone = phone.startsWith('+') ? phone : phone.startsWith('8') ? `+7${phone.slice(1)}` : `+7${phone.replace(/^7/, '')}`;
    const body = {
      name: data.get('name'),
      phone: normalizedPhone,
      email: data.get('email'),
      deliveryType: data.get('deliveryType'),
      address: data.get('address'),
      comment: data.get('comment'),
      items: savedCart,
      promoCode: data.get('promoCode'),
      giftWrap: form.elements.giftWrap.checked,
      giftCardText: data.get('giftCardText'),
      consentData: form.elements.consentData.checked,
      consentOffer: form.elements.consentOffer.checked
    };
    trackGoal('begin_checkout');
    let idempotencyKey = sessionStorage.getItem('family-soft-order-key');
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      sessionStorage.setItem('family-soft-order-key', idempotencyKey);
    }
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      const result = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Idempotency-Key': idempotencyKey }
      });
      trackGoal('order_created');
      savedCart.splice(0, savedCart.length);
      saveCart();
      sessionStorage.removeItem('family-soft-order-key');
      if (result.confirmationUrl) location.assign(result.confirmationUrl);
      else location.assign(result.statusUrl);
    } catch (exception) {
      error.textContent = exception.message;
      submit.disabled = false;
    }
  });
}

async function renderOrder(orderId, publicToken) {
  const order = await api(`/api/orders/${encodeURIComponent(orderId)}/status?t=${encodeURIComponent(publicToken)}`);
  const statusLabels = {
    pending: order.payment_method === 'seller_contact' ? 'Продавец свяжется для согласования оплаты' : 'Ожидаем оплату',
    paid: 'Оплачено',
    canceled: 'Не оплачено',
    refunded: 'Возврат оформлен'
  };
  const orderStatusLabels = {
    new: order.payment_status === 'paid' ? 'Оплачен, ожидает сборки' : 'Принят',
    on_hold: 'Проверяется',
    in_progress: 'Собирается',
    ready: 'Готов к выдаче',
    shipped: 'Отправлен',
    done: 'Завершён',
    canceled: 'Отменён'
  };
  const items = order.items.map(item => `<li>${escapeHtml(item.name)}${item.variant ? ` (${escapeHtml(item.variant)})` : ''} × ${item.quantity} — ${money(item.lineTotal)}</li>`).join('');
  const manual = order.payment_method === 'manual' && order.payment_status === 'pending';
  shell(`<section class="page-main container"><div class="form-card">
    <div class="breadcrumbs"><a href="/">Главная</a> / Заказ №${order.id}</div>
    <h1>${order.payment_status === 'paid' ? 'Заказ оплачен — спасибо!' : `Заказ №${order.id}`}</h1>
    <p class="notice ${order.payment_status === 'paid' ? 'success' : ''}" id="payment-status">Статус оплаты: <strong>${escapeHtml(statusLabels[order.payment_status] || order.payment_status)}</strong></p>
    <p class="notice" id="order-status">Статус заказа: <strong>${escapeHtml(orderStatusLabels[order.status] || order.status)}</strong></p>
    ${order.payment_status === 'paid' ? '<div class="empty-state"><img src="/img/logo.jpg" alt="Выдры Family Soft"><p>Пусть новая покупка принесёт дому ещё больше уюта 💛</p></div>' : ''}
    <div class="payment-details"><strong>Состав заказа</strong><ul>${items}</ul><div>Товары: ${money(order.subtotal)}</div>${order.discount ? `<div>Скидка: −${money(order.discount)}</div>` : ''}<div>Доставка: ${money(order.delivery_price)}</div>${order.gift_wrap ? `<div>Подарочная упаковка: ${money(shopConfig.giftWrapPrice)}</div>` : ''}<strong>Итого: ${money(order.total)}</strong></div>
    ${manual ? `<h2>Оплата через СБП</h2><p>Переводите только эту уникальную сумму. В комментарии укажите номер заказа.</p>
      <div class="payment-amount">${formatKopecks(order.pay_amount_unique)}</div>
      <div class="payment-details">
        <div>Номер СБП: <strong>${escapeHtml(order.manualPayment?.phone || 'Реквизиты пока не настроены')}</strong></div>
        <div>Банк: <strong>${escapeHtml(order.manualPayment?.bank || '—')}</strong></div>
        <div>Получатель: <strong>${escapeHtml(order.manualPayment?.receiver || '—')}</strong></div>
        <div>Комментарий: <strong>Заказ №${order.id}</strong></div>
      </div>
      <p class="notice">Мы никогда не просим коды из SMS, данные карты или оплату на другие номера. Не отправляйте скриншоты как подтверждение платежа.</p>
      <button id="paid-notice" type="button">Я оплатил</button><p id="paid-message" aria-live="polite"></p>` : ''}
    ${order.payment_method === 'seller_contact' && order.payment_status === 'pending' ? '<p class="notice">Не переводите деньги самостоятельно. Продавец свяжется с вами и согласует способ оплаты.</p>' : ''}
    <p>Вопросы по заказу: <a href="${phoneHref(shopConfig.phone)}">${escapeHtml(shopConfig.phone)}</a></p>
    </div></section>`, `Заказ №${order.id}`);
  document.querySelector('#paid-notice')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api(`/api/orders/${order.id}/paid-notice`, {
        method: 'POST', body: JSON.stringify({ publicToken })
      });
      document.querySelector('#paid-message').textContent = result.message;
      button.textContent = 'Сообщение отправлено';
    } catch (error) {
      document.querySelector('#paid-message').textContent = error.message;
      button.disabled = false;
    }
  });
  if (!['done', 'canceled'].includes(order.status) && !['canceled', 'refunded'].includes(order.payment_status)) {
    const poll = async () => {
      try {
        const latest = await api(`/api/orders/${encodeURIComponent(orderId)}/status?t=${encodeURIComponent(publicToken)}`);
        if (latest.payment_status !== order.payment_status || latest.status !== order.status) {
          await renderOrder(orderId, publicToken);
        } else setTimeout(poll, 3000);
      } catch {
        setTimeout(poll, 6000);
      }
    };
    setTimeout(poll, 3000);
  }
}

function formatKopecks(value) {
  const amount = Number(value) || 0;
  return `${new Intl.NumberFormat('ru-RU').format(Math.floor(amount / 100))},${String(amount % 100).padStart(2, '0')} ₽`;
}

async function renderFaq() {
  currentFaq = await api('/api/faq');
  const structuredData = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: currentFaq.map(item => ({
      '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer }
    }))
  };
  shell(`<section class="page-main container"><div class="page-intro"><h1>Частые вопросы</h1><p>Всё важное о заказе, оплате, доставке и уходе за изделиями.</p></div>
    <div class="faq-list">${currentFaq.map(item => `<details><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`).join('')}</div>
    <script type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, '\\u003c')}</script></section>`, 'Частые вопросы');
}

async function renderStaticPage(slug) {
  const page = await api(`/api/pages/${encodeURIComponent(slug)}`);
  const extra = slug === 'contacts' ? `<div class="content-card contact-extra"><h2>Напишите нам</h2><p>Позвоните по номеру <a href="${phoneHref(shopConfig.phone)}">${escapeHtml(shopConfig.phone)}</a> или отправьте сообщение.</p>
    <form class="form-stack" id="contact-form"><label>Имя<input name="name" required maxlength="100"></label><label>Email или телефон<input name="contact" required maxlength="150"></label><label>Сообщение<textarea name="message" required maxlength="1000"></textarea></label><p class="error-message" id="contact-error"></p><button>Отправить сообщение</button></form></div>` : '';
  shell(`<section class="page-main container"><div class="breadcrumbs"><a href="/">Главная</a> / ${escapeHtml(page.title)}</div><article class="content-card"><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.content)}</p></article>${extra}</section>`, page.title);
  document.querySelector('#contact-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const result = await api('/api/contact', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      form.innerHTML = `<p class="notice success">${escapeHtml(result.message)}</p>`;
    } catch (error) {
      document.querySelector('#contact-error').textContent = error.message;
    }
  });
}

async function renderCustom() {
  shell(`<section class="page-main container"><div class="breadcrumbs"><a href="/">Главная</a> / Индивидуальный заказ</div>
    <div class="form-card"><h1>Работа на заказ</h1><p>Расскажите, какое изделие вы представляете. Мы свяжемся, чтобы уточнить размеры, ткань и сроки.</p>
      <form class="form-stack" id="custom-form"><div class="form-grid"><label>Имя<input name="name" required maxlength="100" autocomplete="name"></label><label>Телефон или email<input name="contact" required maxlength="150" autocomplete="email"></label></div>
        <label>Тип изделия<input name="itemType" required maxlength="100" placeholder="Например, комплект постельного белья"></label>
        <label>Размеры, цвет, ткань и описание<textarea name="details" required maxlength="2000" minlength="10"></textarea></label>
        <label>Желаемый срок<input type="text" name="deadline" maxlength="100" placeholder="Например, к началу декабря"></label>
        <p class="notice">На этом этапе заявка принимает текстовое описание. Не указывайте в форме платёжные данные и коды подтверждения.</p><p id="custom-error" class="error-message"></p>
        <button type="submit">Отправить заявку</button></form><div id="custom-result"></div></div></section>`, 'Работа на заказ');
  document.querySelector('#custom-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button');
    submit.disabled = true;
    try {
      const result = await api('/api/custom-requests', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      trackGoal('custom_request');
      form.remove();
      document.querySelector('#custom-result').innerHTML = `<p class="notice success">${escapeHtml(result.message)} Номер заявки: ${result.id}. <a href="${escapeHtml(result.statusUrl)}">Смотреть статус заявки</a></p>`;
    } catch (error) {
      document.querySelector('#custom-error').textContent = error.message;
      submit.disabled = false;
    }
  });
}

async function renderBlog(slug = '') {
  const posts = await api('/api/blog');
  if (!slug) {
    shell(`<section class="page-main container"><div class="page-intro"><h1>Заметки об уюте</h1><p>Полезное о текстиле, подарках и бережном уходе.</p></div>
      <div class="blog-grid">${posts.map(post => `<article class="blog-card"><img src="${escapeHtml(imageUrl(post.cover))}" alt="" loading="lazy" width="720" height="480"><div><h2><a href="/blog/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2><a href="/blog/${encodeURIComponent(post.slug)}">Читать →</a></div></article>`).join('')}</div></section>`, 'Блог');
    return;
  }
  const post = posts.find(item => item.slug === slug);
  if (!post) return renderNotFound();
  const paragraphs = post.content_md.split(/\n{2,}/).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
  shell(`<section class="page-main container"><div class="breadcrumbs"><a href="/blog">Блог</a> / ${escapeHtml(post.title)}</div><article class="content-card">
    <img class="product-main-image" src="${escapeHtml(imageUrl(post.cover))}" alt="" width="900" height="600"><h1>${escapeHtml(post.title)}</h1>${paragraphs}</article>
    <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: post.title, image: imageUrl(post.cover), datePublished: post.created_at }).replace(/</g, '\\u003c')}</script></section>`, post.title);
}

async function renderSizeGuide() {
  const products = await loadProducts('category=family-sets');
  shell(`<section class="page-main container"><div class="page-intro"><h1>Подбор размера</h1><p>Выберите тип спального места — покажем размеры, указанные в карточках комплектов.</p></div>
    <div class="form-card"><label>Размер спального места<select id="bed-size"><option value="">Выберите вариант</option><option value="90">Односпальная кровать</option><option value="140">Полуторная кровать</option><option value="160">Двуспальная кровать</option><option value="180">Большая двуспальная кровать</option></select></label>
      <div id="size-results" class="section"></div></div></section>`, 'Подбор размера');
  document.querySelector('#bed-size').addEventListener('change', event => {
    const selected = event.currentTarget.value;
    const suitable = products.products.filter(product => selected && (
      selected === '90' ? /полутор|147|150/i.test(product.dimensions) :
        selected === '140' ? /полутор|евро|200×220/i.test(`${product.name} ${product.dimensions}`) :
          /евро|семейн|200×220/i.test(`${product.name} ${product.dimensions}`)
    ));
    document.querySelector('#size-results').innerHTML = selected ? cardGrid(suitable) : '';
    bindAddToCart(suitable);
  });
}

async function renderAccount() {
  const session = await api('/api/account/session');
  if (!session.authenticated) {
    shell(`<section class="page-main container"><div class="form-card"><h1>Личный кабинет</h1>
      <p>Войдите по одноразовому коду из email, который указывали при заказе. Здесь будут ваши покупки, оплаты и отзывы.</p>
      ${!shopConfig.accountLoginAvailable ? `<p class="notice">Вход временно недоступен: ${!shopConfig.accountEmailReady ? 'не настроена отправка писем (SMTP).' : ''}${!shopConfig.accountEmailReady && !shopConfig.accountSessionReady ? ' ' : ''}${!shopConfig.accountSessionReady ? 'не задан SESSION_SECRET длиной от 32 символов.' : ''}</p>` : ''}
      <form id="account-email-form" class="form-stack"><label>Email<input type="email" name="email" autocomplete="email" required maxlength="254"></label>
        <p id="account-error" class="error-message" role="alert"></p><button type="submit" ${!shopConfig.accountLoginAvailable ? 'disabled' : ''}>Получить код</button></form>
      <form id="account-code-form" class="form-stack" hidden><label>Код из письма<input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label>
        <button type="submit">Войти</button></form><p id="account-message" aria-live="polite"></p></div></section>`, 'Личный кабинет');
    const emailForm = document.querySelector('#account-email-form');
    const codeForm = document.querySelector('#account-code-form');
    emailForm.addEventListener('submit', async event => {
      event.preventDefault();
      const email = new FormData(emailForm).get('email');
      const error = document.querySelector('#account-error');
      error.textContent = '';
      try {
        const result = await api('/api/account/request-code', { method: 'POST', body: JSON.stringify({ email }) });
        document.querySelector('#account-message').textContent = result.message;
        codeForm.hidden = false;
        codeForm.dataset.email = String(email).trim().toLowerCase();
        codeForm.elements.code.focus();
      } catch (requestError) { error.textContent = requestError.message; }
    });
    codeForm.addEventListener('submit', async event => {
      event.preventDefault();
      const error = document.querySelector('#account-error');
      error.textContent = '';
      try {
        const result = await api('/api/account/verify-code', {
          method: 'POST', body: JSON.stringify({ email: codeForm.dataset.email, code: codeForm.elements.code.value })
        });
        sessionStorage.setItem('family-soft-customer-csrf', result.csrf);
        await renderAccount();
      } catch (requestError) { error.textContent = requestError.message; }
    });
    return;
  }

  const account = await api('/api/account');
  const reviewed = new Map(account.reviews.map(review => [`${review.order_id}:${review.product_id}`, review]));
  const paymentLabels = {
    pending: 'Ожидает оплаты',
    paid: 'Оплачено',
    canceled: 'Отменено',
    refunded: 'Возврат оформлен'
  };
  const refundLabels = { requested: 'Запрос принят', processing: 'Рассматривается', rejected: 'Отклонён', completed: 'Возврат выполнен' };
  const refundsByOrder = new Map();
  account.refunds.forEach(refund => {
    if (!refundsByOrder.has(refund.order_id)) refundsByOrder.set(refund.order_id, refund);
  });
  const orders = account.orders.map(order => {
    const reviewForms = new Set();
    const paymentStatus = order.payment_status === 'pending' && order.payment_method === 'seller_contact'
      ? 'Продавец свяжется для согласования оплаты'
      : paymentLabels[order.payment_status] || order.payment_status;
    const items = order.items.map(item => {
      const existingReview = reviewed.get(`${order.id}:${item.productId}`);
      const mayReview = order.payment_status === 'paid' && !existingReview && !reviewForms.has(item.productId);
      if (mayReview) reviewForms.add(item.productId);
      const reviewForm = mayReview
        ? `<form class="review-form" data-review-form data-order-id="${order.id}" data-product-id="${item.productId}">
            <label>Оценка<select name="rating"><option value="5">5 — Отлично</option><option value="4">4 — Хорошо</option><option value="3">3 — Нормально</option><option value="2">2 — Плохо</option><option value="1">1 — Очень плохо</option></select></label>
            <label>Ваш отзыв<textarea name="body" minlength="10" maxlength="1000" required placeholder="Расскажите о товаре (от 10 символов)"></textarea></label>
            <button class="secondary small-button" type="submit">Отправить отзыв</button></form>`
        : existingReview ? `<p class="review-status">Ваш отзыв: ${escapeHtml(existingReview.body)} · ${existingReview.status === 'published' ? 'опубликован' : existingReview.status === 'rejected' ? 'не опубликован' : 'ожидает проверки'}</p>` : '';
      return `<li><a href="/product/${item.productId}">${escapeHtml(item.name)}</a>${item.variant ? ` (${escapeHtml(item.variant)})` : ''} × ${item.quantity} — ${money(item.lineTotal)}${reviewForm}</li>`;
    }).join('');
    return `<article class="account-order"><div class="review-heading"><h3>Заказ №${order.id}</h3><time>${escapeHtml(order.created_at)}</time></div>
      <p>Статус заказа: ${escapeHtml(order.status)} · <strong>${escapeHtml(paymentStatus)}</strong></p>
      <ul>${items}</ul><p class="account-order-total">Итого: ${money(order.total)}</p></article>`;
  }).join('');
  const payments = account.orders.map(order => {
    const refund = refundsByOrder.get(order.id);
    const paymentStatus = refund?.status === 'completed'
      ? 'Возврат выполнен'
      : order.payment_status === 'pending' && order.payment_method === 'seller_contact'
        ? 'Согласуйте оплату с продавцом'
        : paymentLabels[order.payment_status] || order.payment_status;
    const refundSection = refund
      ? `<p class="refund-status">Возврат: <strong>${refundLabels[refund.status] || refund.status}</strong>${refund.reason ? ` · ${escapeHtml(refund.reason)}` : ''}</p>`
      : order.payment_status === 'paid'
        ? `<form class="refund-form" data-refund-form data-order-id="${order.id}">
            <label>Причина запроса возврата<textarea name="reason" minlength="10" maxlength="1000" required placeholder="Опишите причину (от 10 символов)"></textarea></label>
            <button class="secondary small-button" type="submit">Запросить возврат</button></form>` : '';
    return `<article class="payment-row">
    <div><strong>Заказ №${order.id}</strong><span>${escapeHtml(order.created_at)}</span></div>
      <div><strong>${money(order.total)}</strong><span>${escapeHtml(paymentStatus)} · ${order.payment_method === 'manual' ? 'СБП' : order.payment_method === 'seller_contact' ? 'оплата по согласованию' : 'ЮKassa / СБП'}</span>${refundSection}</div>
  </article>`;
  }).join('');
  shell(`<section class="page-main container"><div class="account-heading"><div><div class="breadcrumbs"><a href="/">Главная</a> / Личный кабинет</div>
      <h1>Здравствуйте${account.profile.name ? `, ${escapeHtml(account.profile.name)}` : ''}!</h1><p>${escapeHtml(account.profile.email)}${account.profile.latest_order_phone ? ` · ${escapeHtml(account.profile.latest_order_phone)}` : ''}</p></div>
      <button class="secondary" id="account-logout" type="button">Выйти</button></div>
    <section class="account-section"><h2>История покупок</h2>${orders ? `<div class="account-orders">${orders}</div>` : '<p class="empty-state">Пока заказов нет. После покупки история появится здесь.</p>'}</section>
    <section class="account-section"><h2>История платежей</h2>${payments ? `<div class="payment-history">${payments}</div>` : '<p>Платежей пока нет.</p>'}
      <p class="product-meta">Запрос возврата не переводит деньги автоматически: магазин рассмотрит его и отдельно выполнит перевод. Данные банковских карт сайт не хранит. Вопросы: <a href="${phoneHref(shopConfig.phone)}">${escapeHtml(shopConfig.phone)}</a>.</p></section>
    <section class="account-section"><h2>Ваши отзывы</h2>${account.reviews.length
      ? `<div class="review-list">${account.reviews.map(review => `<article class="review-card"><strong>${escapeHtml(review.body)}</strong><p>${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} · ${review.status === 'published' ? 'Опубликован' : review.status === 'rejected' ? 'Не опубликован' : 'На проверке'}</p></article>`).join('')}</div>`
      : '<p class="product-meta">Оставить отзыв можно о купленном и оплаченном товаре в истории заказа.</p>'}</section></section>`, 'Личный кабинет');
  document.querySelector('#account-logout').addEventListener('click', async () => {
    try {
      await api('/api/account/logout', {
        method: 'POST', headers: { 'X-CSRF-Token': session.csrf }, body: '{}'
      });
      sessionStorage.removeItem('family-soft-customer-csrf');
      await renderAccount();
    } catch (error) { showToast(error.message); }
  });
  document.querySelectorAll('[data-review-form]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/account/reviews', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrf },
        body: JSON.stringify({
          orderId: Number(form.dataset.orderId), productId: Number(form.dataset.productId),
          rating: Number(data.get('rating')), body: data.get('body')
        })
      });
      await renderAccount();
      showToast('Отзыв отправлен на проверку.');
    } catch (error) {
      button.disabled = false;
      showToast(error.message);
    }
  }));
  document.querySelectorAll('[data-refund-form]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/account/refunds', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrf },
        body: JSON.stringify({ orderId: Number(form.dataset.orderId), reason: new FormData(form).get('reason') })
      });
      await renderAccount();
      showToast('Запрос возврата отправлен магазину.');
    } catch (error) {
      button.disabled = false;
      showToast(error.message);
    }
  }));
}

async function renderCustomStatus(id, requestToken) {
  const request = await api(`/api/custom-requests/${encodeURIComponent(id)}/status?t=${encodeURIComponent(requestToken)}`);
  const labels = { new: 'Новая', consultation: 'Согласование', in_progress: 'В работе', ready: 'Готово', delivered: 'Передано' };
  let displayedStatus = request.status;
  shell(`<section class="page-main container"><article class="form-card"><div class="breadcrumbs"><a href="/">Главная</a> / <a href="/custom">Работа на заказ</a> / Заявка №${request.id}</div>
    <h1>Заявка №${request.id}</h1><p class="notice" id="request-status">Статус: <strong>${escapeHtml(labels[request.status] || request.status)}</strong></p>
    <div class="payment-details"><strong>${escapeHtml(request.item_type)}</strong><p>${escapeHtml(request.details)}</p><span>Создана: ${escapeHtml(request.created_at)}</span></div>
    <p>Чтобы уточнить детали, позвоните нам: <a href="${phoneHref(shopConfig.phone)}">${escapeHtml(shopConfig.phone)}</a>.</p></article></section>`, `Заявка №${request.id}`);
  const poll = async () => {
    try {
      const latest = await api(`/api/custom-requests/${encodeURIComponent(id)}/status?t=${encodeURIComponent(requestToken)}`);
      const current = document.querySelector('#request-status');
      if (current && latest.status !== displayedStatus) {
        current.innerHTML = `Статус: <strong>${escapeHtml(labels[latest.status] || latest.status)}</strong>`;
        displayedStatus = latest.status;
      }
      if (latest.status !== 'delivered') setTimeout(poll, 30000);
    } catch {
      setTimeout(poll, 60000);
    }
  };
  if (request.status !== 'delivered') setTimeout(poll, 30000);
}

async function renderFavorites() {
  const results = await Promise.allSettled(savedFavorites.map(id => api(`/api/products/${id}`)));
  const products = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  shell(`<section class="page-main container"><div class="breadcrumbs"><a href="/">Главная</a> / Избранное</div><h1>Избранное</h1>
    ${products.length ? `<div class="product-grid">${products.map(product => productCard(product).replace('</article>', `<button class="secondary small-button favorite-remove" type="button" data-remove-favorite="${product.id}">Убрать из избранного</button></article>`)).join('')}</div>` :
      `<div class="empty-state"><img src="/img/logo.jpg" alt="Выдры Family Soft"><h2>Здесь пока нет любимчиков</h2><p>Сохраняйте понравившиеся товары, чтобы вернуться к ним позже.</p><a class="button" href="/catalog">Открыть каталог</a></div>`}</section>`, 'Избранное');
  bindAddToCart(products);
  document.querySelectorAll('[data-remove-favorite]').forEach(button => button.addEventListener('click', () => {
    const index = savedFavorites.indexOf(Number(button.dataset.removeFavorite));
    if (index >= 0) savedFavorites.splice(index, 1);
    saveFavorites();
    renderFavorites().catch(error => showToast(error.message));
  }));
}

async function renderNotFound() {
  shell(`<section class="page-main container"><div class="error-page"><img src="/img/logo.jpg" alt="Логотип Family Soft"><h1>Ой, мы это потеряли в пледе</h1><p>Такой страницы не нашли. Вернитесь на главную — там всегда уютно.</p><a class="button" href="/">На главную</a></div></section>`, 'Страница не найдена');
}

async function renderAdmin() {
  appRoot.innerHTML = `<main id="main" class="page-main container"><div id="admin-root" class="form-card"><div class="loading">Проверяем доступ…</div></div></main>`;
  document.title = 'Администрирование | Family Soft';
  const adminRoot = document.querySelector('#admin-root');
  const status = await api('/api/admin/setup-status');
  if (!status.enabled) {
    adminRoot.innerHTML = `<h1>Панель управления</h1><p class="notice">Для защищённой админки задайте переменные ADMIN_PASSWORD и SESSION_SECRET на сервере. Без них вход недоступен.</p><a class="button secondary" href="/">Вернуться в магазин</a>`;
    return;
  }
  if (!status.configured) {
    adminRoot.innerHTML = `<h1>Первая настройка админки</h1><p>Настройте TOTP. Секрет будет создан и показан только один раз.</p>
      <form id="admin-setup-form" class="form-stack"><label>Пароль администратора<input name="password" type="password" autocomplete="current-password" required></label><p class="error-message" id="admin-error"></p><button>Создать TOTP-секрет</button></form><div id="totp-setup"></div>`;
    document.querySelector('#admin-setup-form').addEventListener('submit', async event => {
      event.preventDefault();
      const password = new FormData(event.currentTarget).get('password');
      try {
        const result = await api('/api/admin/setup', { method: 'POST', body: JSON.stringify({ password }) });
        document.querySelector('#admin-setup-form').remove();
        document.querySelector('#totp-setup').innerHTML = `<div class="notice"><strong>Секрет для приложения-аутентификатора:</strong><p><code>${escapeHtml(result.secret)}</code></p><p>Добавьте его вручную в приложение TOTP, затем нажмите продолжить. Сохраните секрет в надёжном месте.</p></div><button id="to-admin-login">Перейти ко входу</button>`;
        sessionStorage.setItem('family-soft-totp-setup-seen', '1');
        document.querySelector('#to-admin-login').addEventListener('click', () => renderAdmin().catch(showToast));
      } catch (error) { document.querySelector('#admin-error').textContent = error.message; }
    });
    return;
  }

  const previousCsrf = sessionStorage.getItem('family-soft-admin-csrf');
  if (!previousCsrf) {
    adminRoot.innerHTML = `<h1>Вход в админку</h1><form id="admin-login-form" class="form-stack">
      <label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
      <label>Код из приложения-аутентификатора<input name="code" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="8" required></label>
      <p class="error-message" id="admin-error" role="alert"></p><button>Войти</button></form>`;
    document.querySelector('#admin-login-form').addEventListener('submit', async event => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.currentTarget));
      try {
        const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify(body) });
        sessionStorage.setItem('family-soft-admin-csrf', result.csrf);
        renderAdmin().catch(showToast);
      } catch (error) { document.querySelector('#admin-error').textContent = error.message; }
    });
    return;
  }
  await renderAdminDashboard(adminRoot);
}

async function renderAdminDashboard(container) {
  let section = 'orders';
  const render = async () => {
    const summary = await adminApi('/api/admin/summary');
    container.innerHTML = `<div class="admin-heading"><h1>Панель управления</h1><button class="secondary" id="admin-logout">Выйти</button></div>
      <div class="feature-grid"><article class="feature"><h3>Заказов сегодня</h3><p>${summary.today_orders || 0}</p></article><article class="feature"><h3>Выручка сегодня</h3><p>${money(summary.today_revenue || 0)}</p></article><article class="feature"><h3>На проверке</h3><p>${summary.on_hold || 0}</p></article></div>
      ${summary.warnings.map(warning => `<p class="notice">${escapeHtml(warning)}</p>`).join('')}
      <div class="admin-layout section"><nav class="admin-nav" aria-label="Разделы админки">
        <button class="secondary" data-admin-section="orders">Заказы</button><button class="secondary" data-admin-section="products">Товары</button>
        <button class="secondary" data-admin-section="custom-requests">Заявки</button><button class="secondary" data-admin-section="contact-messages">Сообщения</button>
        <button class="secondary" data-admin-section="reviews">Отзывы</button><button class="secondary" data-admin-section="refunds">Возвраты</button>
        <button class="secondary" data-admin-section="settings">Настройки</button><button class="secondary" data-admin-section="security">Список блокировки</button>
        <button class="secondary" data-admin-section="log">Журнал действий</button></nav>
        <section id="admin-content" class="admin-panel" aria-live="polite"><div class="loading">Загружаем…</div></section></div>`;
    document.querySelector('#admin-logout').addEventListener('click', async () => {
      try { await adminApi('/api/admin/logout', { method: 'POST', body: '{}' }); } finally {
        sessionStorage.removeItem('family-soft-admin-csrf');
        renderAdmin().catch(showToast);
      }
    });
    document.querySelectorAll('[data-admin-section]').forEach(button => button.addEventListener('click', () => {
      section = button.dataset.adminSection;
      renderAdminSection(section).catch(error => showToast(error.message));
    }));
    await renderAdminSection(section);
  };
  async function renderAdminSection(name) {
    const target = document.querySelector('#admin-content');
    if (!target) return;
    if (name === 'orders') {
      const orders = await adminApi('/api/admin/orders');
      target.innerHTML = `<div class="admin-heading"><h2>Заказы</h2><a class="button secondary" href="/api/admin/orders.csv" target="_blank">Экспорт CSV</a></div>
        ${orders.length ? orders.map(order => `<article class="admin-order">
          <div class="admin-order-head"><strong>Заказ №${order.id} · ${money(order.total)}</strong><span>${escapeHtml(order.customer_name)} · ${escapeHtml(order.phone)}</span></div>
          <div>${escapeHtml(order.email)} · ${escapeHtml(order.created_at)} · оплата: ${escapeHtml(order.payment_status)} · риск: ${order.risk_score}/100 ${order.risk_reasons.map(escapeHtml).join(' · ')}</div>
          <div class="form-grid"><label>Статус<select data-order-status="${order.id}">${[['new','Новый'],['on_hold','На проверке'],['in_progress','Собирается'],['ready','Готов к выдаче'],['shipped','Отправлен'],['done','Завершён'],['canceled','Отменён']].map(([value,label]) => `<option value="${value}" ${value === order.status ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
          ${order.payment_method === 'manual' && order.payment_status === 'pending' ? `<label class="check-row"><input type="checkbox" data-bank-check="${order.id}"> Я проверил поступление в банке: сумма, отправитель и комментарий совпадают</label>` : ''}</div>
          <div class="admin-heading"><button class="secondary small-button" data-save-status="${order.id}">Сохранить статус</button>${order.payment_method === 'manual' && order.payment_status === 'pending' ? `<button class="small-button" data-confirm-payment="${order.id}">Подтвердить оплату</button>` : ''}</div>
        </article>`).join('') : '<p>Заказов пока нет.</p>'}`;
      target.querySelectorAll('[data-save-status]').forEach(button => button.addEventListener('click', async () => {
        try {
          const id = button.dataset.saveStatus;
          await adminApi(`/api/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: target.querySelector(`[data-order-status="${id}"]`).value }) });
          showToast('Статус обновлён.');
        } catch (error) { showToast(error.message); }
      }));
      target.querySelectorAll('[data-confirm-payment]').forEach(button => button.addEventListener('click', async () => {
        const id = button.dataset.confirmPayment;
        const bankChecked = target.querySelector(`[data-bank-check="${id}"]`).checked;
        try {
          await adminApi(`/api/admin/orders/${id}/confirm-payment`, { method: 'POST', body: JSON.stringify({ bankChecked }) });
          showToast('Оплата подтверждена.');
          renderAdminSection('orders').catch(error => showToast(error.message));
        } catch (error) { showToast(error.message); }
      }));
      return;
    }
    if (name === 'products') {
      const [products, categories] = await Promise.all([adminApi('/api/admin/products'), api('/api/categories')]);
      target.innerHTML = `<h2>Товары</h2><form id="product-form" class="form-stack content-card">
        <h3 id="product-form-title">Добавить товар</h3><input type="hidden" name="id">
        <label>Название<input name="name" required maxlength="150"></label><label>Категория<select name="categoryId" required>${categories.filter(item => item.slug !== 'custom').map(category => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('')}</select></label>
        <div class="form-grid"><label>Цена, ₽<input name="price" type="number" min="0" step="1" required></label><label>Количество<input name="stockQty" type="number" min="0" max="10000" value="0"></label></div>
        <label>Описание<textarea name="description" maxlength="3000"></textarea></label><div class="form-grid"><label>Материал<input name="material" maxlength="200"></label><label>Размеры<input name="dimensions" maxlength="300"></label></div>
        <label>Уход<input name="care" maxlength="500"></label><label>Варианты через запятую<input name="variants"></label><label>Изображения товара<input name="imageFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple></label>
        <div id="product-image-preview"></div><label class="check-row"><input name="inStock" type="checkbox" checked> В продаже</label><button>Сохранить товар</button><button type="button" id="product-reset" class="secondary">Очистить форму</button></form>
        <div class="admin-table-wrap section"><table><thead><tr><th>Товар</th><th>Цена</th><th>Остаток</th><th>Действия</th></tr></thead><tbody>${products.map(product => `<tr><td>${escapeHtml(product.name)}</td><td>${money(product.price)}</td><td>${product.stock_qty}</td><td><button class="secondary small-button" data-edit-product="${product.id}">Изменить</button> <button class="danger small-button" data-delete-product="${product.id}">Удалить</button></td></tr>`).join('')}</tbody></table></div>`;
      const form = target.querySelector('#product-form');
      const uploadedImages = [];
      form.elements.imageFiles.addEventListener('change', async event => {
        for (const file of [...event.currentTarget.files].slice(0, 5 - uploadedImages.length)) {
          const body = new FormData();
          body.append('image', file);
          try {
            const result = await adminApi('/api/admin/products/image', { method: 'POST', body });
            uploadedImages.push(result.url);
            target.querySelector('#product-image-preview').innerHTML = uploadedImages.map(url => `<img src="${escapeHtml(url)}" width="90" height="75" alt="Предпросмотр">`).join('');
          } catch (error) { showToast(error.message); }
        }
      });
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        const id = values.id;
        const data = {
          ...values, categoryId: Number(values.categoryId), price: Number(values.price), stockQty: Number(values.stockQty),
          variants: values.variants.split(',').map(value => value.trim()).filter(Boolean),
          images: uploadedImages, inStock: form.elements.inStock.checked
        };
        try {
          await adminApi(id ? `/api/admin/products/${id}` : '/api/admin/products', {
            method: id ? 'PUT' : 'POST', body: JSON.stringify(data)
          });
          showToast('Товар сохранён.');
          renderAdminSection('products').catch(error => showToast(error.message));
        } catch (error) { showToast(error.message); }
      });
      target.querySelector('#product-reset').addEventListener('click', () => {
        form.reset();
        form.elements.id.value = '';
        uploadedImages.splice(0, uploadedImages.length);
        target.querySelector('#product-image-preview').innerHTML = '';
        target.querySelector('#product-form-title').textContent = 'Добавить товар';
      });
      target.querySelectorAll('[data-edit-product]').forEach(button => button.addEventListener('click', () => {
        const product = products.find(item => item.id === Number(button.dataset.editProduct));
        if (!product) return;
        form.elements.id.value = product.id;
        form.elements.name.value = product.name;
        form.elements.categoryId.value = product.category_id;
        form.elements.price.value = product.price;
        form.elements.stockQty.value = product.stock_qty;
        form.elements.description.value = product.description;
        form.elements.material.value = product.material;
        form.elements.dimensions.value = product.dimensions;
        form.elements.care.value = product.care;
        form.elements.variants.value = product.variants.join(', ');
        form.elements.inStock.checked = Boolean(product.in_stock);
        uploadedImages.splice(0, uploadedImages.length, ...product.images);
        target.querySelector('#product-image-preview').innerHTML = uploadedImages.map(url => `<img src="${escapeHtml(url)}" width="90" height="75" alt="Предпросмотр">`).join('');
        target.querySelector('#product-form-title').textContent = `Редактировать: ${product.name}`;
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
      target.querySelectorAll('[data-delete-product]').forEach(button => button.addEventListener('click', async () => {
        if (!confirm('Удалить или скрыть этот товар?')) return;
        try {
          await adminApi(`/api/admin/products/${button.dataset.deleteProduct}`, { method: 'DELETE' });
          showToast('Изменения сохранены.');
          renderAdminSection('products').catch(error => showToast(error.message));
        } catch (error) { showToast(error.message); }
      }));
      return;
    }
    if (name === 'custom-requests') {
      const requests = await adminApi('/api/admin/custom-requests');
      const labels = { new: 'Новая', consultation: 'Согласование', in_progress: 'В работе', ready: 'Готово', delivered: 'Передано' };
      target.innerHTML = `<h2>Заявки на индивидуальный заказ</h2>${requests.length ? requests.map(request => `<article class="admin-order">
        <div class="admin-order-head"><strong>Заявка №${request.id} · ${escapeHtml(request.item_type)}</strong><span>${escapeHtml(request.name)} · ${escapeHtml(request.contact)}</span></div>
        <p>${escapeHtml(request.details)}</p><p>Срок: ${escapeHtml(request.deadline || 'не указан')} · ${escapeHtml(request.created_at)}</p>
        <label>Статус<select data-request-status="${request.id}">${Object.entries(labels).map(([value,label]) => `<option value="${value}" ${value === request.status ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <button class="secondary small-button" data-save-request="${request.id}">Сохранить статус</button></article>`).join('') : '<p>Заявок пока нет.</p>'}`;
      target.querySelectorAll('[data-save-request]').forEach(button => button.addEventListener('click', async () => {
        const id = button.dataset.saveRequest;
        try {
          await adminApi(`/api/admin/custom-requests/${id}/status`, {
            method: 'PATCH', body: JSON.stringify({ status: target.querySelector(`[data-request-status="${id}"]`).value })
          });
          showToast('Статус заявки обновлён.');
        } catch (error) { showToast(error.message); }
      }));
      return;
    }
    if (name === 'contact-messages') {
      const messages = await adminApi('/api/admin/contact-messages');
      target.innerHTML = `<h2>Сообщения покупателей</h2>${messages.length ? messages.map(message => `<article class="admin-order">
        <div class="admin-order-head"><strong>${escapeHtml(message.name)} · ${escapeHtml(message.contact)}</strong><span>${escapeHtml(message.created_at)} · ${escapeHtml(message.status)}</span></div>
        <p>${escapeHtml(message.message)}</p><label>Статус<select data-contact-status="${message.id}">${[['new','Новое'],['read','Прочитано'],['resolved','Обработано']].map(([value,label]) => `<option value="${value}" ${value === message.status ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <button class="secondary small-button" data-save-contact="${message.id}">Сохранить статус</button></article>`).join('') : '<p>Сообщений пока нет.</p>'}`;
      target.querySelectorAll('[data-save-contact]').forEach(button => button.addEventListener('click', async () => {
        const id = button.dataset.saveContact;
        try {
          await adminApi(`/api/admin/contact-messages/${id}/status`, {
            method: 'PATCH', body: JSON.stringify({ status: target.querySelector(`[data-contact-status="${id}"]`).value })
          });
          showToast('Статус сообщения обновлён.');
        } catch (error) { showToast(error.message); }
      }));
      return;
    }
    if (name === 'reviews') {
      const reviews = await adminApi('/api/admin/reviews');
      target.innerHTML = `<h2>Отзывы покупателей</h2>${reviews.length ? reviews.map(review => `<article class="admin-order">
        <div class="admin-order-head"><strong>${escapeHtml(review.product_name)} · ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</strong>
          <span>Заказ №${review.order_id} · ${escapeHtml(review.customer_name || review.email)} · ${escapeHtml(review.created_at)}</span></div>
        <p>${escapeHtml(review.body)}</p><p>Статус: ${review.status === 'pending' ? 'На проверке' : review.status === 'published' ? 'Опубликован' : 'Отклонён'}</p>
        ${review.status !== 'published' ? `<button class="small-button" data-review-action="${review.id}" data-review-status="published">Опубликовать</button>` : ''}
        ${review.status !== 'rejected' ? `<button class="secondary small-button" data-review-action="${review.id}" data-review-status="rejected">Отклонить</button>` : ''}
        </article>`).join('') : '<p>Отзывов пока нет.</p>'}`;
      target.querySelectorAll('[data-review-action]').forEach(button => button.addEventListener('click', async () => {
        try {
          await adminApi(`/api/admin/reviews/${button.dataset.reviewAction}/status`, {
            method: 'PATCH', body: JSON.stringify({ status: button.dataset.reviewStatus })
          });
          await renderAdminSection('reviews');
          showToast(button.dataset.reviewStatus === 'published' ? 'Отзыв опубликован.' : 'Отзыв отклонён.');
        } catch (error) { showToast(error.message); }
      }));
      return;
    }
    if (name === 'refunds') {
      const refunds = await adminApi('/api/admin/refunds');
      const labels = { requested: 'Запрос принят', processing: 'Рассматривается', rejected: 'Отклонён', completed: 'Возврат выполнен' };
      target.innerHTML = `<h2>Запросы на возврат</h2><p class="notice">Смена статуса здесь не переводит деньги. Выполните возврат отдельно в банке или платёжном сервисе и только потом отметьте его завершённым.</p>
        ${refunds.length ? refunds.map(refund => `<article class="admin-order">
          <div class="admin-order-head"><strong>Заказ №${refund.order_id} · ${money(refund.total)}</strong><span>${escapeHtml(refund.customer_name || refund.email)} · ${escapeHtml(refund.created_at)}</span></div>
          <p>${escapeHtml(refund.reason)}</p><p>Статус: ${escapeHtml(labels[refund.status] || refund.status)}</p>
          ${refund.status === 'requested' ? `<div class="form-grid"><button class="secondary small-button" data-refund-action="${refund.id}" data-refund-status="processing">Рассматривается</button>
            <button class="secondary small-button" data-refund-action="${refund.id}" data-refund-status="rejected">Отклонить</button></div>` : ''}
          ${refund.status === 'processing' ? `<div class="form-grid"><button class="secondary small-button" data-refund-action="${refund.id}" data-refund-status="rejected">Отклонить</button>
            <button class="small-button" data-refund-action="${refund.id}" data-refund-status="completed">Отметить возврат выполненным</button></div>` : ''}
          ${refund.status === 'rejected' ? `<button class="secondary small-button" data-refund-action="${refund.id}" data-refund-status="processing">Возобновить рассмотрение</button>` : ''}
        </article>`).join('') : '<p>Запросов на возврат пока нет.</p>'}`;
      target.querySelectorAll('[data-refund-action]').forEach(button => button.addEventListener('click', async () => {
        try {
          await adminApi(`/api/admin/refunds/${button.dataset.refundAction}/status`, {
            method: 'PATCH', body: JSON.stringify({ status: button.dataset.refundStatus })
          });
          await renderAdminSection('refunds');
          showToast('Статус запроса обновлён.');
        } catch (error) { showToast(error.message); }
      }));
      return;
    }
    if (name === 'settings') {
      const settings = await adminApi('/api/admin/settings');
      target.innerHTML = `<h2>Настройки магазина</h2><form id="settings-form" class="form-stack content-card">
        <label>Телефон поддержки<input name="owner_phone_display" value="${escapeHtml(settings.owner_phone_display)}" maxlength="40"></label>
        <label>Стоимость доставки, ₽<input name="delivery_price" type="number" min="0" value="${escapeHtml(settings.delivery_price)}"></label>
        <label>Порог бесплатной доставки, ₽<input name="free_delivery_threshold" type="number" min="0" value="${escapeHtml(settings.free_delivery_threshold)}"></label>
        <label>Цена подарочной упаковки, ₽<input name="gift_wrap_price" type="number" min="0" value="${escapeHtml(settings.gift_wrap_price)}"></label>
        <label>Адрес самовывоза<input name="pickup_address" value="${escapeHtml(settings.pickup_address)}" maxlength="300"></label>
        <label>Порог проверки риска (0–100)<input name="risk_threshold" type="number" min="0" max="100" value="${escapeHtml(settings.risk_threshold)}"></label>
        <p class="notice">Реквизиты СБП и ключи оплаты на этой странице не редактируются — они задаются переменными окружения сервера.</p><button>Сохранить настройки</button></form>`;
      target.querySelector('#settings-form').addEventListener('submit', async event => {
        event.preventDefault();
        try {
          await adminApi('/api/admin/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
          showToast('Настройки сохранены.');
        } catch (error) { showToast(error.message); }
      });
      return;
    }
    if (name === 'security') {
      const entries = await adminApi('/api/admin/blocklist');
      target.innerHTML = `<h2>Список блокировки</h2><p>IP-адреса хранятся в виде хэша и не отображаются открытым текстом.</p>
        <form id="blocklist-form" class="form-stack content-card"><label>Тип<select name="type"><option value="email">Email</option><option value="phone">Телефон</option><option value="domain">Домен</option><option value="ip">IP-адрес</option></select></label>
        <label>Значение<input name="value" required maxlength="254"></label><label>Причина<input name="reason" maxlength="300"></label><button>Добавить в блокировку</button></form>
        <div class="admin-table-wrap section"><table><thead><tr><th>Тип</th><th>Значение</th><th>Причина</th><th>Действие</th></tr></thead><tbody>
        ${entries.map(item => `<tr><td>${escapeHtml(item.type)}</td><td>${item.type === 'ip' ? 'Хэш IP' : escapeHtml(item.value)}</td><td>${escapeHtml(item.reason)}</td><td><button class="danger small-button" data-remove-block="${item.id}">Удалить</button></td></tr>`).join('')}</tbody></table></div>`;
      target.querySelector('#blocklist-form').addEventListener('submit', async event => {
        event.preventDefault();
        try {
          await adminApi('/api/admin/blocklist', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
          showToast('Добавлено в список блокировки.');
          renderAdminSection('security').catch(error => showToast(error.message));
        } catch (error) { showToast(error.message); }
      });
      target.querySelectorAll('[data-remove-block]').forEach(button => button.addEventListener('click', async () => {
        try {
          await adminApi(`/api/admin/blocklist/${button.dataset.removeBlock}`, { method: 'DELETE' });
          showToast('Запись удалена.');
          renderAdminSection('security').catch(error => showToast(error.message));
        } catch (error) { showToast(error.message); }
      }));
      return;
    }
    if (name === 'log') {
      const rows = await adminApi('/api/admin/log');
      target.innerHTML = `<h2>Журнал действий</h2><div class="admin-table-wrap"><table><thead><tr><th>Время</th><th>Действие</th><th>Объект</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.created_at)}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.target)}</td></tr>`).join('')}</tbody></table></div>`;
    }
  }
  render().catch(error => {
    if (error.message.includes('Войдите') || error.message.includes('Сессия')) sessionStorage.removeItem('family-soft-admin-csrf');
    container.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p><button id="admin-retry">Продолжить</button>`;
    container.querySelector('#admin-retry')?.addEventListener('click', () => renderAdmin().catch(showToast));
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Service worker unavailable:', error.message));
  }
}

async function start() {
  try {
    shopConfig = await api('/api/config');
    applyTheme();
    setInterval(applyTheme, 60_000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) applyTheme();
    });
    window.addEventListener('storage', event => {
      if (event.key === themePreferenceKey) {
        themePreference = themeOptions.includes(event.newValue) ? event.newValue : 'auto';
        applyTheme();
        const selector = document.querySelector('#theme-select');
        if (selector) selector.value = themePreference;
      }
    });
    const path = decodeURIComponent(location.pathname);
    if (path === '/') return await renderHome();
    if (path === '/miniapp') return await renderHome();
    if (path.startsWith('/miniapp/product/')) return await renderProduct(path.slice('/miniapp/product/'.length));
    if (path === '/miniapp/custom') return await renderCustom();
    if (path === '/catalog') return await renderCatalog(new URLSearchParams(location.search).get('category') || '');
    if (path.startsWith('/category/')) return await renderCatalog(path.slice('/category/'.length));
    if (path.startsWith('/product/')) return await renderProduct(path.slice('/product/'.length));
    if (path === '/cart') return await renderCart();
    if (path === '/checkout') return await renderCheckout();
    if (path === '/faq') return await renderFaq();
    if (path === '/custom') return await renderCustom();
    if (path.startsWith('/custom/request/')) {
      const id = path.slice('/custom/request/'.length);
      return await renderCustomStatus(id, new URLSearchParams(location.search).get('t') || '');
    }
    if (path === '/blog') return await renderBlog();
    if (path.startsWith('/blog/')) return await renderBlog(path.slice('/blog/'.length));
    if (path === '/size-guide') return await renderSizeGuide();
    if (path === '/account' || path.startsWith('/account/')) return await renderAccount();
    if (path === '/favorites') return await renderFavorites();
    if (path === '/admin' || path.startsWith('/admin/')) return await renderAdmin();
    if (path.startsWith('/order/') && path.endsWith('/status')) {
      const segments = path.split('/');
      return await renderOrder(segments[2], new URLSearchParams(location.search).get('t') || '');
    }
    const pageSlug = ({ '/about': 'about', '/contacts': 'contacts', '/delivery': 'delivery', '/privacy': 'privacy', '/offer': 'offer', '/safe-shopping': 'safe-shopping' })[path];
    if (pageSlug) return await renderStaticPage(pageSlug);
    return await renderNotFound();
  } catch (error) {
    console.error(error);
    appRoot.innerHTML = `${header()}<main id="main" class="page-main container"><div class="error-page"><h1>Не удалось загрузить страницу</h1><p>${escapeHtml(error.message)}</p><button type="button" id="reload-page">Повторить</button></div></main>${footer()}`;
    document.querySelector('#reload-page')?.addEventListener('click', () => location.reload());
  }
}

start();
