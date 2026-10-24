@import "tailwindcss";
@import "@fontsource/anuphan/400.css";
@import "@fontsource/anuphan/500.css";
@import "@fontsource/anuphan/600.css";
@import "leaflet/dist/leaflet.css";

@theme {
  /* Blue theme from the "Chill with me" home page design (#2067DA).
     Token names are kept from the first version so every page re-themes from here. */
  --font-display: "Anuphan", "Noto Sans Thai", system-ui, sans-serif;
  --font-sans: "Anuphan", "Noto Sans Thai", system-ui, sans-serif;

  --color-forest: #2067da;       /* brand primary */
  --color-forest-deep: #1652b5;  /* primary hover */
  --color-moss: #5e88ca;         /* secondary blue */
  --color-leaf: #dce8fb;         /* light blue fill */
  --color-mist: #f1f5fc;         /* very light blue surface */
  --color-cream: #f7f8fa;        /* page background (inner pages) */
  --color-sand: #eceff4;         /* neutral surface */
  --color-ink: #1d2433;
  --color-muted: #5f6878;
  --color-sun: #f5a524;          /* warnings / highlights only */
  --color-sun-soft: #fdf1dc;
  --color-alert: #d1435b;
  --color-alert-soft: #fbe5e9;
}

html { -webkit-text-size-adjust: 100%; }
body {
  background: var(--color-cream);
  color: var(--color-ink);
  font-family: var(--font-sans);
  line-height: 1.6;
}
h1, h2, h3 { font-family: var(--font-display); line-height: 1.3; font-weight: 500; }

:focus-visible { outline: 3px solid var(--color-moss); outline-offset: 2px; border-radius: 6px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}

.leaflet-container { font-family: var(--font-sans); background: var(--color-mist); }
.num-marker {
  background: var(--color-forest); color: #fff; border: 2px solid #fff; border-radius: 999px;
  width: 28px; height: 28px; display: grid; place-items: center; font-weight: 600; font-size: 13px;
  box-shadow: 0 1px 4px rgba(22, 82, 181, 0.4);
}
.num-marker.kind-hotel { background: #4a5a8a; }
.num-marker.kind-food { background: #9a6b2f; }
.num-marker.start { background: var(--color-sun); color: var(--color-ink); }

.trail-line { background-image: linear-gradient(var(--color-moss) 50%, transparent 0); background-size: 2px 10px; }

.skeleton { background: linear-gradient(90deg, var(--color-sand) 0%, #f6f8fb 50%, var(--color-sand) 100%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }

.no-scrollbar::-webkit-scrollbar { display: none; }
