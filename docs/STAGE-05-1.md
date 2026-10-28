# Stage 5.1 — Full 3D Folder Motion

## Implemented

- A folder-open state with a 120-degree flap rotation and a lift in Z space.
- Three CSS document layers rise from the folder with configurable stagger timing (`CONFIG.folder3d.staggerMs`).
- The selected folder's 3D animation runs before navigation into the folder.
- Desktop fine-pointer drag-and-drop reorders folder tiles visually within the current website session. It does not write metadata to Google Drive or change the real Drive hierarchy.
- Tile serials update after reordering. The in-memory visual order is reapplied when the root list is rendered again.
- Reduced-motion users skip the opening delay and can still navigate. Touch/mobile remains tap-to-open without drag interactions.
- Pointer drag suppresses the synthetic click generated at pointer-up, preventing a dropped folder from also opening.

## Design controls

| Control | Default | Source |
| --- | ---: | --- |
| Scene perspective | 1200px | `CONFIG.folder3d.perspective` |
| Hover lift | 20px | `CONFIG.folder3d.hoverLift` |
| Open lift | 60px | `CONFIG.folder3d.openLift` |
| Open duration | 520ms | `CONFIG.folder3d.openDuration` |
| Paper stagger | 40ms | `CONFIG.folder3d.staggerMs` |
| Drag threshold | 7px | `CONFIG.folder3d.dragThreshold` |
| Drag scale | 1.035× | `CONFIG.folder3d.dragScale` |
| Idle float cycle | 6000ms | `CONFIG.folder3d.floatDuration` |

## Manual QA checklist

1. On desktop, hover a root folder: object lifts and tab responds.
2. Click or keyboard-activate a root folder: tab rotates, paper layers rise in order, then its contents appear.
3. Drag a root folder to another root folder: visual shelf order changes and serial numbers refresh.
4. After drag-and-drop, verify no folder was opened accidentally and no Drive mutation occurred.
5. On a touch-sized viewport, tap to open a folder; no drag affordance is required.
6. Enable `prefers-reduced-motion`: folder navigation remains immediate and functional.
7. In live mode, refresh and browse folders; only Drive read/list/download scope remains enabled.

## Verification scope

JavaScript syntax, static HTML/CSS structure, local module references, mock dataset shape, and ZIP integrity are checked in this stage. The full Vite/Tailwind build and browser-level visual animation test still require installing dependencies and running the project in a browser. No claim of a successful live Google Drive authorization test is made without the user's OAuth client and folder ID.


## Theme update — Blood Moon

- Palette changed to soot charcoal, dried-blood burgundy, vellum paper, and tarnished brass.
- Added CSS-only ambient red haze, faint engraved circles, paper grain and folder lacquer details.
- Drive access stays read-only; folder count, folder navigation, drag reorder, preview/download and Google OAuth modules remain as before.
