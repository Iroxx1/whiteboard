// Runs before the app loads to avoid a light flash in dark mode. Keep in sync with src/lib/theme.ts.
;(() => {
  let pref = 'system'
  try {
    pref = localStorage.getItem('wb.theme') || 'system'
  } catch {}
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
})()
