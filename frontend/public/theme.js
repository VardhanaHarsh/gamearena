// Applies the saved theme before first paint (external file so the CSP can forbid inline scripts).
try {
  if (localStorage.getItem('ga-theme') === 'light') document.documentElement.classList.replace('dark', 'light')
} catch (e) {}
