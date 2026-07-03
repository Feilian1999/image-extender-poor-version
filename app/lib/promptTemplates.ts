'use client'

import {
  TILESET_COLS,
  TILESET_ROWS,
  TILESET_SLOTS,
  TILESET_TILE_SIZE,
  TileSetRole,
} from '@/app/lib/tileset'

// ─────────────────────────────────────────────────────────────────────────────
// SHARED PROMPT TEMPLATES — the copy-paste-friendly, TEXT-ONLY prompts shown in
// the Prompt Guide page so a user can generate the "big sheet" on ANY external
// image generator, then bring it back and use each studio's "Import sheet"
// button to slice / de-background / export it (no API call).
//
// NOTE ON DRIFT: these deliberately DO NOT share a string with the server
// prompts in `app/api/generate/route.ts`. Those are IMAGE-TO-IMAGE prompts that
// reference an attached structural guide / pose-map / identity image — language
// that is meaningless in a text-only external tool. These templates are the
// self-contained text-only equivalents. The per-frame CHOREOGRAPHY wording is
// kept intentionally identical to the route's so the two stay recognizably the
// same animation; if you tune one, mirror the other.
// ─────────────────────────────────────────────────────────────────────────────

export const KEY_COLOR_HEX = '#FF00FF'

// Layout constants MUST match the studio slicers so an externally-generated
// sheet lands on clean cell boundaries when imported back in.
export const SPRITE_TEMPLATE_COLS = 4
export const SPRITE_TEMPLATE_ROWS = 2
export const SPRITE_TEMPLATE_CELL = 512

export const PROP_TEMPLATE_COLS = 4
export const PROP_TEMPLATE_ROWS = 2
export const PROP_TEMPLATE_CELL = 512

export type SpriteChoreoAnim =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'attack'
  | 'hurt'
  | 'death'

interface ChoreoSpec {
  label: string
  /** One-line header describing the motion + loop behaviour. */
  header: string
  /** Exactly SPRITE_TEMPLATE_COLS × SPRITE_TEMPLATE_ROWS per-frame pose lines. */
  frames: string[]
  /** Optional trailing notes appended after the frame map. */
  footer?: string[]
}

// Biped humanoid choreography — mirrors `animChoreography` in the generate
// route. Each `frames` entry is one grid cell in row-major reading order.
export const SPRITE_CHOREOGRAPHY: Record<SpriteChoreoAnim, ChoreoSpec> = {
  idle: {
    label: 'Idle / breathing',
    header:
      'IDLE / BREATHING LOOP (character is STANDING STILL and CALM — the lowest-motion animation, so consistency between cells matters MORE here than anywhere else):',
    frames: [
      'rest pose. Standing relaxed, feet planted, weight even. Chest at relaxed midpoint, arms hanging at the sides (or weapon held at rest, pointing down).',
      'inhale begins — chest and shoulders rise a few pixels, knees straighten a hair. Hands stay at the sides.',
      'inhaling — chest fuller, shoulders a touch higher, head holds steady.',
      'PEAK INHALE — chest at its HIGHEST/fullest, shoulders highest, posture tallest. Knees nearly straight.',
      'exhale begins — chest and shoulders settling back down.',
      'exhaling — chest lowering toward the midpoint, shoulders relaxing.',
      'SETTLE — lowest point of the breath, knees soften slightly so the body dips a hair, head tips down a touch. Feet stay planted.',
      'return to the rest pose, NEAR-IDENTICAL to FRAME 1. Frame 8 → frame 1 must loop seamlessly.',
    ],
    footer: [
      'The motion is SUBTLE but REAL: the chest/shoulders rise and fall and the knees softly flex. The FEET stay planted on the same baseline; the HORIZONTAL position never changes.',
      'The character is the EXACT SAME SIZE in every cell — do NOT zoom in or out between cells. Head at the same height (±a few px for breathing), feet on the same line in all 8 cells.',
      'The character stays in RIGHT-facing profile, calm and standing, in all 8 frames.',
    ],
  },
  walk: {
    label: 'Walk cycle',
    header:
      'WALK CYCLE — character WALKS IN PLACE, profile, facing RIGHT, feet stay at the SAME horizontal position relative to the cell (no horizontal translation across frames):',
    frames: [
      'CONTACT — right leg forward and straight, right foot just touching ground at the front; left leg back and lifted slightly off ground. Body upright. Left arm forward, right arm back.',
      'DOWN — weight shifts onto right (front) leg. Body at LOWEST point of cycle. Left foot lifted higher behind. Arms swinging through.',
      'PASS — left leg passes directly under body (vertical, foot below hip). Body rising back up. Right leg straight behind. Arms near sides.',
      'HIGH POINT — left leg now forward and reaching, right leg straight behind and lifting off. Body at HIGHEST point of cycle. Right arm forward, left arm back.',
      'CONTACT (mirror of frame 1) — left leg forward and straight, foot just touching ground; right leg back and lifted slightly. Right arm forward, left arm back.',
      'DOWN (mirror of frame 2) — weight on left leg, body at LOWEST point, right foot lifted behind.',
      'PASS (mirror of frame 3) — right leg passes directly under body. Body rising.',
      'HIGH POINT (mirror of frame 4) — right leg forward and reaching, left leg straight behind. Body at HIGHEST point. Left arm forward, right arm back. Frame 8 → frame 1 must loop seamlessly.',
    ],
    footer: [
      'Arms swing OPPOSITE to legs (when left leg is forward, right arm is forward).',
      'The character DOES NOT advance forward across cells — it walks in place. Treat each cell as a snapshot of the character on an invisible treadmill.',
    ],
  },
  run: {
    label: 'Run cycle',
    header:
      'RUN CYCLE — character RUNS IN PLACE, profile, facing RIGHT, body leaning FORWARD throughout, feet stay at the SAME horizontal position relative to the cell (no horizontal translation):',
    frames: [
      'RIGHT FOOT STRIKE — right leg planted forward at ground, left leg pulled up high behind with knee bent ~90°. Body leaning forward. Right arm back, left arm forward.',
      'PUSH-OFF — right leg straightening and driving back, body launching upward. Left knee still high in front.',
      'AIRBORNE — BOTH FEET OFF THE GROUND. Knees high. Body in mid-air, leaning forward. Mid-stride.',
      'LEFT FOOT REACH — left leg extending forward to land. Right leg trailing behind.',
      'LEFT FOOT STRIKE (mirror of frame 1) — left leg planted forward, right leg pulled up high behind. Left arm back, right arm forward.',
      'PUSH-OFF (mirror of frame 2) — left leg straightening and driving back, body launching upward. Right knee high in front.',
      'AIRBORNE (mirror of frame 3) — BOTH FEET OFF THE GROUND. Knees high. Mid-air.',
      'RIGHT FOOT REACH (mirror of frame 4) — right leg extending forward to land. Frame 8 → frame 1 must loop seamlessly.',
    ],
    footer: [
      'Arms bent ~90° at the elbows, pumping STRONGLY in opposition to the legs.',
      'Character does NOT advance forward across cells — it runs in place on an invisible treadmill.',
    ],
  },
  jump: {
    label: 'Jump (plays once)',
    header:
      'JUMP ACTION — character jumps IN PLACE, profile, facing RIGHT, plays ONCE (does NOT loop). Feet stay at the SAME horizontal position relative to the cell on takeoff and landing (purely vertical motion):',
    frames: [
      'standing neutral pose, feet planted at the cell baseline. Arms at sides.',
      'CROUCH wind-up — knees bent deeply, body lowered, arms swinging back behind the body. Feet still on ground.',
      'LAUNCH — legs straightening explosively, arms swinging forward and up, feet just leaving the ground. Body still relatively low.',
      'ASCENDING — body straightening, rising, knees beginning to tuck up under the body. Arms reaching up.',
      'PEAK — HIGHEST point of jump. Body compact: knees tucked up to chest, arms up overhead for balance. Body high in cell.',
      'DESCENDING — legs extending downward toward the ground, body falling. Arms still mostly up.',
      'LANDING IMPACT — feet just touching the ground at the cell baseline, knees bent absorbing impact, arms forward for balance, body slightly forward.',
      'recovery to standing — matching the neutral pose of FRAME 1.',
    ],
    footer: [
      'Vertical motion only. The character’s horizontal position (left/right within its cell) does NOT change between cells.',
    ],
  },
  attack: {
    label: 'Attack (plays once)',
    header:
      'ATTACK ACTION — character attacks IN PLACE, profile, facing RIGHT, plays ONCE (does NOT loop). Character’s feet are PLANTED at the cell baseline through the whole action (no horizontal translation):',
    frames: [
      'neutral combat stance. Weapon held at the ready (sword in hand, fist clenched, staff vertical, etc.).',
      'anticipation — weapon pulled back slightly, body coiling, weight shifting onto back leg.',
      'DEEP WIND-UP — PEAK COIL. Weight FULLY on back leg, front leg slightly raised, weapon at MAXIMUM back position behind the body.',
      'forward burst — body uncoiling, weapon traveling forward fast, weight shifting onto front leg.',
      'IMPACT / MAX EXTENSION — weapon at FURTHEST forward point of the swing, body in a full lunge forward, front leg planted firmly forward, back leg straightening behind. Peak energy.',
      'follow-through — weapon swinging slightly past the impact point, body still committed forward.',
      'recovery start — weapon pulling back toward the body, weight rebalancing onto the back leg.',
      'return to neutral combat stance — matching FRAME 1 exactly.',
    ],
    footer: [
      'Only the upper body and weapon arm have large motion; the feet rotate planted-front to planted-back but stay at roughly the same horizontal position.',
    ],
  },
  hurt: {
    label: 'Hurt / take damage',
    header:
      'HURT / TAKE DAMAGE — character takes a hit IN PLACE, profile, facing RIGHT, plays ONCE. Feet stay at the SAME horizontal position relative to the cell:',
    frames: [
      'neutral standing stance.',
      'IMPACT — body sharply jolted BACKWARD (away from facing direction), head snaps back, arms flying outward, expression pained, knees slightly buckling.',
      'PEAK RECOIL — body leaning farthest back, knees buckled, off-balance, arms still flailing.',
      'stagger 1 — body still leaning back but starting to recover, arms coming inward to find balance.',
      'stagger 2 — body returning toward upright, head straightening, arms settling.',
      'nearly recovered — slight remaining backward lean, knees re-straightening.',
      'settling — almost back to neutral, weight rebalancing onto both feet.',
      'recovered neutral stance — matching FRAME 1.',
    ],
  },
  death: {
    label: 'Death / collapse',
    header:
      'DEATH / COLLAPSE — character collapses IN PLACE, profile, facing RIGHT, plays ONCE, ends in a final resting pose. Character does NOT translate horizontally — body folds down toward the cell baseline:',
    frames: [
      'standing, taking a final hit, shock pose, body just beginning to lose strength.',
      'knees buckling, body sagging downward, head dropping.',
      'dropping to one knee, body folding forward, one arm reaching to the ground for support.',
      'both knees on the ground now, torso slumping forward, head hanging.',
      'falling sideways, torso tilting down toward the ground, balance lost.',
      'nearly horizontal, one arm extended along the ground, body collapsing.',
      'on the ground, body settling, last small movements.',
      'lying motionless on the ground at the bottom of the cell — final defeated rest pose, eyes closed.',
    ],
  },
}

export const SPRITE_ANIM_OPTIONS: { value: SpriteChoreoAnim; label: string }[] =
  (Object.keys(SPRITE_CHOREOGRAPHY) as SpriteChoreoAnim[]).map((value) => ({
    value,
    label: SPRITE_CHOREOGRAPHY[value].label,
  }))

/** Numbers each frame line with its (column, row) coordinate, row-major. */
function buildFrameMap(lines: string[], cols: number): string {
  return lines
    .map((line, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      return `- FRAME ${i + 1} (column ${c}, row ${r}): ${line}`
    })
    .join('\n')
}

/**
 * Builds the full, self-contained TEXT-ONLY sprite-sheet prompt for an external
 * generator. Paste into any text-to-image tool, set the output to
 * cols·cell × rows·cell, then import the result via Sprite → Import sheet.
 */
export function buildSpriteSheetPromptText(
  anim: SpriteChoreoAnim,
  characterDesc: string
): string {
  const cols = SPRITE_TEMPLATE_COLS
  const rows = SPRITE_TEMPLATE_ROWS
  const cell = SPRITE_TEMPLATE_CELL
  const frames = cols * rows
  const W = cols * cell
  const H = rows * cell
  const spec = SPRITE_CHOREOGRAPHY[anim]
  const desc = characterDesc.trim() || '<describe your character here>'

  const readingOrder =
    `(col=0,row=0)=FRAME 1, ` +
    Array.from({ length: cols - 1 }, (_, i) => `(col=${i + 1},row=0)=FRAME ${i + 2}`).join(', ') +
    `, then (col=0,row=1)=FRAME ${cols + 1}, ..., (col=${cols - 1},row=${rows - 1})=FRAME ${frames}`

  const choreo = [spec.header, buildFrameMap(spec.frames, cols), ...(spec.footer ?? []).map((f) => `- ${f}`)]
    .join('\n')

  return `You are generating a single SPRITE-SHEET IMAGE: a ${cols}×${rows} grid of ${frames} animation keyframes for a 2D side-view game character. Each grid cell is exactly ${cell}×${cell} pixels. The full sheet is exactly ${W}×${H} pixels, a WIDE ${W}:${H} canvas — NOT a square canvas and NOT a screenshot/mockup containing a smaller sheet.

GRID LAYOUT (single most important rule — read it twice):
- The output is ONE IMAGE containing ${frames} separate frames laid out as ${cols} columns × ${rows} rows.
- Reading order is ROW-MAJOR: ${readingOrder}.
- EACH CELL CONTAINS EXACTLY ONE FRAME, fully drawn inside that cell. No visible cell borders, gridlines, frame numbers, or separators.
- EXACTLY ONE SINGLE CHARACTER PER CELL — never a twin, clone, duplicate, mirror, reflection, or second figure beside the main one. One cell = one character.
- HARD CELL BOUNDARIES: the character stays fully inside its cell. Leave at least ~8% flat-magenta margin around it. Never crop the character at a cell edge.
- The MAGENTA background is CONTINUOUS across the whole sheet wherever the character isn't drawn — no white/dark/pink line between cells.

ONE CONTINUOUS ANIMATION:
- All ${frames} cells are a SINGLE cycle of ONE motion. Not two animations, not two gaits. Cells flow 1 → ${frames} and frame ${frames} loops back into frame 1.
- The bottom row is the CONTINUATION of the SAME cycle as the top row: identical motion type, energy, forward lean, stride length and scale.

FRAME ALIGNMENT (this kills "flicker"):
- SAME BASELINE — the character's FEET sit on the SAME horizontal line in every cell. Imagine one straight horizontal line across the whole sheet at foot level; every frame's feet touch it (airborne frames sit above it by the SAME amount each time).
- SAME EYE LEVEL — head/eyes on the same line in every cell (±~10% cell height max).
- SAME SCALE — the character's head-to-foot height is IDENTICAL in every cell: about 80% of the cell height, top of head ~10% down from the cell top, feet on the baseline. Do NOT draw the character bigger in some cells and smaller in others — this is the most common mistake; measure the head-to-foot height and keep it constant across all cells.
- SAME HORIZONTAL POSITION — the character's center sits at the same relative position in every cell. The motion is STATIONARY / "in place" — treat it as an invisible treadmill.
- IDENTICAL CHARACTER — same outfit, colors, silhouette, proportions, head, hair, weapon in every cell. ONLY the pose changes.

BACKGROUND (every cell):
- Outside the character silhouette, perfectly flat solid pure magenta ${KEY_COLOR_HEX} (R=255, G=0, B=255). No gradient, shading, halo, or anti-alias bleed.
- The character's own pixels must AVOID pure magenta (no hot-pink hair / magenta clothing). Use slightly desaturated cousins (rose, red-leaning pink) if needed.

ART DIRECTION:
- Side-view (profile), character facing RIGHT in every cell.
- Crisp silhouette against the magenta. NO drop shadow, ground plane, ground line, motion-blur lines, or ground decorations.
- Even ambient lighting — no directional cast shadows, rim light, or spotlight.
- No text, captions, frame numbers, UI, health bars, signature, or watermark.

ANIMATION CHOREOGRAPHY:
${choreo}

CHARACTER DESCRIPTION (the SAME character in every cell): "${desc}".

Output the sprite sheet: ${frames} cells in a ${cols}×${rows} grid, identical character, identical position/scale/baseline per the alignment rules above, ONE choreography pose per cell, magenta ${KEY_COLOR_HEX} everywhere else. Fill the canvas to the full ${W}×${H} resolution.`
}

export const TILE_TEMPLATE_COLS = TILESET_COLS
export const TILE_TEMPLATE_ROWS = TILESET_ROWS
export const TILE_TEMPLATE_CELL = TILESET_TILE_SIZE

// What each autotile cell must contain. Magenta placement here matches the
// canonical role mask the importer enforces (applyFeatheredRoleMask), so the
// painted art lines up with the forced 25% cuts. `q` = one quarter (25%).
const TILE_ROLE_CELL_DESC: Record<TileSetRole, string> = {
  body: 'BODY / interior fill. The ENTIRE cell is solid material — NO magenta anywhere. Small, EVEN texture with no single big feature; this cell is repeated across the whole platform interior, so it must look uniform and seamless.',
  top: 'TOP edge (the surface a player lands on). Magenta fills the TOP 25% strip (open sky). Material fills the bottom 75%, with the surface cap (grass / snow / moss) running along the TOP of the material where it meets the magenta.',
  bottom: 'BOTTOM edge (platform underside). Magenta fills the BOTTOM 25% strip. Material fills the top 75%; core underside detail (roots, drips, chips) meets the magenta — NO grass cap here.',
  left: 'LEFT vertical edge. Magenta fills the LEFT 25% strip. Material fills the right 75%. Exposed core material on the left face — NO cap.',
  right: 'RIGHT vertical edge. Magenta fills the RIGHT 25% strip. Material fills the left 75%. Exposed core material on the right face — NO cap.',
  tl_outer: 'TOP-LEFT OUTER corner. Magenta fills an L-shape covering the TOP 25% AND the LEFT 25% (open sky at the top-left). Material fills the bottom-right 75%×75%. Grass/snow cap along the exposed TOP edge, wrapping the corner.',
  tr_outer: 'TOP-RIGHT OUTER corner. Magenta fills an L covering the TOP 25% AND the RIGHT 25%. Material fills the bottom-left 75%×75%. Cap along the exposed TOP edge, wrapping the corner.',
  bl_outer: 'BOTTOM-LEFT OUTER corner. Magenta fills an L covering the BOTTOM 25% AND the LEFT 25%. Material fills the top-right 75%×75%. NO cap (underside / side faces).',
  br_outer: 'BOTTOM-RIGHT OUTER corner. Magenta fills an L covering the BOTTOM 25% AND the RIGHT 25%. Material fills the top-left 75%×75%. NO cap.',
  tl_inner: 'TOP-LEFT INNER corner (concave). Material fills the WHOLE cell EXCEPT a 25%×25% magenta square bitten out of the TOP-LEFT corner. Interior material identical to the body cell — same palette, texture, scale.',
  tr_inner: 'TOP-RIGHT INNER corner. Material fills the whole cell EXCEPT a 25%×25% magenta square bitten out of the TOP-RIGHT corner. Match the body material.',
  bl_inner: 'BOTTOM-LEFT INNER corner. Material fills the whole cell EXCEPT a 25%×25% magenta square bitten out of the BOTTOM-LEFT corner. Match the body material.',
  br_inner: 'BOTTOM-RIGHT INNER corner. Material fills the whole cell EXCEPT a 25%×25% magenta square bitten out of the BOTTOM-RIGHT corner. Match the body material.',
}

/**
 * Builds the TEXT-ONLY tile-set prompt as a LABELED 4×4 GRID — one distinct
 * autotile piece per cell, evenly spaced. This is the text-to-image-friendly
 * layout (vs. the fragile continuous "rectangle-with-a-hole" the internal AI
 * uses via image-to-image): each cell is independent, so Tiles → Import map
 * slices it on clean, uniform cell boundaries every time and the importer
 * forces each role's exact magenta mask. 3 cells are unused — leave them blank.
 */
export function buildTileSheetPromptText(material: string): string {
  const cols = TILESET_COLS
  const rows = TILESET_ROWS
  const cell = TILESET_TILE_SIZE
  const W = cols * cell
  const H = rows * cell
  const mat = material.trim() || '<describe your material, e.g. mossy gray stone bricks>'

  const cellLines: string[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const slot = TILESET_SLOTS.find((s) => s.col === c && s.row === r)
      if (slot) {
        cellLines.push(
          `- Cell (column ${c}, row ${r}) — ${slot.label}: ${TILE_ROLE_CELL_DESC[slot.role]}`
        )
      } else {
        cellLines.push(
          `- Cell (column ${c}, row ${r}) — UNUSED: leave this cell entirely flat pure magenta ${KEY_COLOR_HEX}.`
        )
      }
    }
  }

  return `You are painting a SIDE-VIEW 2D PLATFORMER AUTOTILE SHEET as a ${cols}×${rows} grid of ${cols * rows} equal cells. Each cell is exactly ${cell}×${cell} pixels; the full sheet is exactly ${W}×${H} pixels (a SQUARE canvas). Every cell shows ONE tile of the SAME material, painted so the tiles connect seamlessly in a game.

GRID LAYOUT (most important — read twice):
- ${cols} columns × ${rows} rows of equal ${cell}×${cell} cells. NO visible gridlines, borders, labels, numbers, or separators between cells — the grid is implied by position only.
- Reading order is row-major: (column 0, row 0) is top-left; columns increase to the right; rows increase downward.
- Each cell is an INDEPENDENT tile fully contained in its cell — nothing crosses a cell boundary.

WHAT GOES IN EACH CELL (paint EXACTLY these; magenta = the flat pure ${KEY_COLOR_HEX} keyed background):
${cellLines.join('\n')}

CONSISTENCY RULES (critical for a usable tile set):
- SAME MATERIAL, palette, texture scale, and lighting in EVERY cell. The edge/corner tiles are the body material with part of it replaced by magenta — they must look like they were cut from the same slab as the body cell.
- The material in a 'top' cell, the 'top' part of each outer corner, etc. must align so the tiles tile together: the bottom of the 'top' tile matches the top of the 'body' tile; left/right edges match the body; and so on.
- Grass/snow/moss CAP appears ONLY on TOP-facing exposed edges (top edge + top of the two top outer corners). Underside and vertical side faces show CORE material only.

ABSOLUTE RULES:
1. FLAT PURE MAGENTA ${KEY_COLOR_HEX} (R=255, G=0, B=255) for every keyed region and every UNUSED cell — no gradient, shading, halo, or anti-alias bleed. Magenta strips/squares are crisp hard-edged rectangles at exact 25% positions.
2. NO PINK / RED-MAGENTA inside the material. Any pixel with (R>200 AND G<80 AND B>200) is deleted downstream, so mortar = dark gray/tan/brown, lava cracks = orange/red, crystal = blue/white/cyan. ZERO thin pink stripes; material→magenta boundaries are crisp with no transition color.
3. FLAT 2D SIDE-VIEW only — NOT 3D, isometric, or top-down. No perspective, extruded side faces, drop shadows, or beveled blocks. Even ambient lighting.
4. BODY TILE-FRIENDLINESS: the body cell (and inner-corner interiors) are small-scale and uniform — no cell-sized panels, no long streaks spanning a cell, no big geometric patterns, no single hero feature. A 128px patch from anywhere in the interior must look interchangeable with any other.
5. NO text, labels, numbers, gridlines, borders, or captions anywhere.

The material for the whole sheet is: "${mat}". Fill the canvas to the full ${W}×${H} resolution.`
}

/**
 * Builds the TEXT-ONLY prop / decoration-atlas prompt. Generates a cols×rows
 * contact sheet of standalone props on magenta; import via Props → Import sheet.
 */
export function buildPropSheetPromptText(material: string): string {
  const cols = PROP_TEMPLATE_COLS
  const rows = PROP_TEMPLATE_ROWS
  const count = cols * rows
  const theme = material.trim() || '<describe the world / material theme, e.g. lush jungle foliage>'
  return `You are painting a DECORATION / PROP ATLAS for a side-view 2D platformer — small standalone decoration sprites that get scattered ON TOP of a tile map.

LAYOUT — a clean contact sheet:
- A grid of EXACTLY ${cols} columns × ${rows} rows = ${count} equal cells on a flat pure magenta ${KEY_COLOR_HEX} background.
- ONE distinct decoration per cell, CENTERED, sized to fill about 70–80% of the cell with a clear magenta margin on all sides.
- Props must NOT touch or overlap each other or the cell edges — leave generous flat magenta gutters between every prop.

WHAT TO PAINT — a VARIED, surprising mix of decorations that fit this world. Make every one of the ${count} cells a DIFFERENT KIND of object — no two alike, no near-duplicates.

ABSOLUTE RULES:
1. FLAT PURE MAGENTA ${KEY_COLOR_HEX} (R=255, G=0, B=255) everywhere that is not a prop — no gradient, shading, halo, drop shadow, and NO ground line or terrain under any prop. Each prop floats on flat magenta so it keys cleanly to transparency.
2. NO PINK / RED-MAGENTA inside the prop art. The importer deletes any pixel where (R>200 AND G<80 AND B>200), so favor greens, blues, cyans, oranges, yellows, whites, browns, and purples kept below R=200. Edges between prop and magenta must be crisp — NO intermediate pink transition.
3. FLAT 2D SIDE-VIEW only — NOT 3D, NOT isometric, NOT top-down. No perspective, no cast shadows, no horizon.
4. Even, ambient, omnidirectional lighting on every prop. No single hero light, no vignette.
5. NO text, NO labels, NO numbers, NO grid lines, NO borders, NO captions — only the props on magenta.

ART DIRECTION — the props share ONE cohesive material/palette so they look like a matched set from the same world: "${theme}". Hand-painted, clean readable silhouettes, rich but cohesive palette, crisp edges. Fill the canvas to the full ${cols * PROP_TEMPLATE_CELL}×${rows * PROP_TEMPLATE_CELL} resolution.`
}
