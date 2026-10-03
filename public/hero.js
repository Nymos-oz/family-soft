const themePreferenceKey = 'family-soft-theme-v1';
const allowedThemes = ['auto', 'light', 'evening', 'dark'];
let themePreference = 'auto';

try {
  const savedPreference = localStorage.getItem(themePreferenceKey);
  if (allowedThemes.includes(savedPreference)) themePreference = savedPreference;
} catch (error) {
  console.warn('Theme preference could not be loaded:', error.message);
}

const forcedHero = new URLSearchParams(location.search).get('hero');
const themeForLocalTime = () => {
  const hour = new Date().getHours();
  if (hour >= 7 && hour < 17) return 'light';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'dark';
};
const initialTheme = themePreference === 'auto' ? themeForLocalTime() : themePreference;
document.documentElement.dataset.theme = initialTheme;
document.documentElement.dataset.hero = forcedHero === 'day' || forcedHero === 'night'
  ? forcedHero
  : initialTheme === 'light' ? 'day' : initialTheme === 'evening' ? 'evening' : 'night';
document.documentElement.style.colorScheme = initialTheme === 'dark' ? 'dark' : 'light';

const themeColor = document.querySelector('meta[name="theme-color"]');
if (themeColor) themeColor.content = initialTheme === 'dark' ? '#171923' : initialTheme === 'evening' ? '#f2e6dc' : '#FBF6EE';
const colorScheme = document.querySelector('meta[name="color-scheme"]');
if (colorScheme) colorScheme.content = initialTheme === 'dark' ? 'dark' : 'light';

if (location.pathname === '/') {
  for (const filename of ['hero-day.webp', 'hero-night.webp']) {
    const preload = document.createElement('link');
    preload.rel = 'preload';
    preload.as = 'image';
    preload.type = 'image/webp';
    preload.href = `/img/${filename}`;
    document.head.append(preload);
  }
}
