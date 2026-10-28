# Theme update — Bloodborne-inspired Blood Moon

Tema ini mengambil inspirasi umum dari gothic Victorian, horor kosmik, arsip pemburu, batu arang, darah gelap, vellum tua, dan kuningan yang menua. Tidak ada logo, tangkapan layar, atau artwork resmi game yang disalin; ambience dan ornamen dibuat dengan CSS.

## Tujuan visual

- **Background:** arang hampir hitam dengan haze merah redup, vignette visual melalui radial gradients dan tekstur grain.
- **Folder:** lacquer burgundy dengan trim kuningan tipis, layer 3D, shadow berat, serta gerak hover/open yang sudah ada.
- **File sheets:** vellum tua dengan aturan garis yang samar, menyembul dari folder selama animasi open.
- **Typography:** Cinzel untuk headline/display dan Cormorant Garamond untuk teks editorial; fallback lokal tersedia.
- **UI:** metadata mono ringkas, border seperti kuningan kusam, fokus keyboard berwarna emas, dan status yang jelas.

## Design tokens

| Token | Value | Purpose |
|---|---|---|
| `--color-paper` | `#100d0f` | Background arang |
| `--color-ink` | `#eadfcf` | Foreground ivory |
| `--color-blood` | `#78202c` | Burgundy folder |
| `--color-blood-bright` | `#a23842` | Crimson highlight |
| `--color-brass` | `#b49a68` | Trim, hover and focus |
| `--color-paper-bright` | `#d9c9aa` | Vellum / paper layers |
| `--color-line` | `#443135` | Borders |

Update palette in `styles/tokens.css`. `styles/components/ambient.css` handles the subtle red moon haze and engraved circles; `folder3d.css` holds folder lacquer and paper surfaces.

## Runtime and accessibility

- Google Fonts are referenced remotely; if blocked, serif fallbacks are used.
- Google Drive remains read-only; all file management happens in Drive itself.
- `prefers-reduced-motion` behavior is retained.
- Keyboard focus uses a high-contrast brass outline.
- No Three.js or added image assets are needed for this theme pass.
