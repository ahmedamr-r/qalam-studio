/*
 * Shared class recipes (design/spec.md §6). Compose them with clsx: `clsx(r.button, r.buttonPrimary)`.
 * Everything is px (html is 13px, so the rem scale is off by 3.25px per step) and every colour is a
 * theme token, so recipes work in dark and light alike. Motion lives in the .q-* classes:
 *   q-item   hover fill 0ms in / 150ms out        q-press (+ q-press-icon)  scale .97 (.94) on press
 *   q-menu / q-pop / q-flyout / q-tip / q-dialog / q-palette / q-toast  Radix data-state enter + exit
 * Shortcut keys come from the commands registry (formatKeys), never typed by hand: <Kbd keys={…}/>.
 */

// Shared by the size alternatives below (see the Buttons section).
const BUTTON_BASE = "q-press inline-flex shrink-0 items-center justify-center whitespace-nowrap disabled:pointer-events-none disabled:opacity-40";
const ICON_BUTTON_BASE = "q-item q-press q-press-icon grid shrink-0 place-items-center rounded-md hover:bg-hover hover:text-fg aria-pressed:bg-active aria-pressed:text-fg data-[state=open]:bg-active disabled:text-fg-faint disabled:pointer-events-none";

const spec = {
  // ── Shell ─────────────────────────────────────────────────────────────
  topBar: "relative flex h-(--topbar-h) shrink-0 items-center border-b border-line-subtle bg-app",
  brandCell: "grid h-full w-(--rail-w) shrink-0 place-items-center text-accent",
  mainMenuTrigger: "q-item q-press inline-flex h-[28px] items-center gap-[6px] rounded-md pl-[4px] pr-[6px] -ml-[4px] hover:bg-hover data-[state=open]:bg-active [&_svg]:text-fg-subtle",
  crumbs: "absolute left-1/2 flex -translate-x-1/2 items-center gap-[6px] whitespace-nowrap text-body text-fg-subtle",
  crumbSep: "text-fg-faint",
  crumbFile: "q-item inline-flex h-[28px] items-center gap-[4px] rounded-md pl-[6px] pr-[4px] font-medium text-fg hover:bg-hover",
  draftChip: "inline-flex h-[18px] items-center rounded-sm px-[6px] text-micro font-medium text-fg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]",
  topRight: "ml-auto flex items-center gap-[2px] pr-[10px] [&>*]:shrink-0",
  vsep: "mx-[8px] h-[16px] w-px bg-line",
  zoomTrigger: "q-item inline-flex h-[28px] items-center gap-[2px] rounded-md pl-[8px] pr-[4px] text-caption font-medium text-fg-muted tnum hover:bg-hover",
  statusBar: "flex h-(--footer-h) items-center gap-[12px] border-t border-line-subtle bg-app pl-[16px] pr-[10px] text-micro text-fg-subtle whitespace-nowrap",

  // ── Rail ──────────────────────────────────────────────────────────────
  rail: "relative flex w-(--rail-w) shrink-0 flex-col items-center gap-[4px] border-r border-line-subtle bg-app pt-[8px] pb-[10px]",
  railItem: "q-item q-press relative flex size-[48px] flex-col items-center justify-center gap-[3px] rounded-lg text-fg-subtle hover:bg-hover hover:text-fg-muted aria-[current=page]:bg-active aria-[current=page]:text-fg",
  railLabel: "max-w-[48px] truncate text-micro font-medium",            // Layers · Assets · Tokens · AI · Library
  railMarker: "q-rail-marker",                                            // style={{ "--y": `${centerY}px` }}; data-instant on first paint
  railBadge: "absolute right-[11px] top-[8px] size-[6px] rounded-full bg-[image:var(--ai-gradient)] shadow-[0_0_0_2px_var(--color-app)] q-breathe", // AI busy only
  railPlace: "q-item q-press relative grid h-[32px] w-[40px] place-items-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg-muted aria-[current=true]:bg-active aria-[current=true]:text-fg", // the organization's places above a board's panels
  railDivider: "my-[4px] h-px w-[28px] shrink-0 bg-line-subtle",

  // ── Sidebar (pages outside the canvas; ⌘\ folds it to the rail) ─────
  sidebar: "flex w-(--sidebar-w) shrink-0 flex-col gap-[2px] overflow-y-auto border-r border-line-subtle bg-app px-[8px] pt-[8px] pb-[10px]",
  sidebarItem: "q-item relative flex h-[32px] shrink-0 items-center gap-[10px] rounded-md px-[10px] text-body text-fg-muted hover:bg-hover hover:text-fg aria-[current=page]:bg-active aria-[current=page]:font-medium aria-[current=page]:text-fg [&>svg]:shrink-0 [&>svg]:text-fg-subtle aria-[current=page]:[&>svg]:text-fg",
  sidebarGroup: "flex h-[28px] shrink-0 items-center justify-between pl-[10px] pr-[2px] pt-[12px] text-micro font-medium text-fg-subtle",
  sidebarSub: "q-item flex h-[28px] shrink-0 items-center gap-[8px] rounded-md px-[10px] text-caption text-fg-muted hover:bg-hover hover:text-fg aria-[current=true]:bg-active aria-[current=true]:font-medium aria-[current=true]:text-fg",
  /** The column a page's content sits in, under the frame's top bar. */
  pageMain: "mx-auto flex w-full flex-col gap-[28px] px-[24px] py-[28px]",

  // ── Panels ────────────────────────────────────────────────────────────
  panel: "flex min-h-0 flex-col bg-panel",
  panelHeader: "flex h-[40px] shrink-0 items-center justify-between pl-[16px] pr-[8px]",
  panelTitle: "text-caption font-semibold text-fg",
  section: "border-b border-line-subtle pt-[8px] pr-[8px] pb-[12px] pl-[16px]",
  sectionHeader: "grid h-[32px] grid-cols-[1fr_auto] items-center",
  sectionTitle: "text-caption font-semibold text-fg",
  sectionTitleCollapsed: "text-caption font-medium text-fg-subtle",
  inlineSelect: "q-item inline-flex h-[24px] items-center gap-[2px] rounded-md pl-[6px] pr-[2px] text-caption font-medium text-fg-muted hover:bg-hover hover:text-fg [&_svg]:text-fg-subtle",
  fieldCaption: "mt-[4px] mb-[4px] text-micro text-fg-subtle",
  grid3: "grid grid-cols-[1fr_1fr_24px] items-center gap-[8px]",        // EVERY design-panel row; empty cells are <span/>
  rows: "flex flex-col gap-[8px]",

  // ── Layers ────────────────────────────────────────────────────────────
  layerRow: "q-item group/row relative flex h-[28px] items-center gap-[6px] rounded-md pr-[4px] text-body text-fg-muted hover:bg-hover",
  layerRowFrame: "font-medium text-fg",                                   // top-level frames
  layerRowSelected: "bg-selection-subtle font-medium text-fg [&_.ic]:text-selection-label hover:bg-selection-subtle",
  layerGroupSelected: "rounded-md bg-selection-subtle-2",                  // wraps a selected layer's children
  layerTwisty: "grid size-[16px] shrink-0 place-items-center text-fg-subtle q-chevron",   // a control: fg-subtle (fg-faint is under 3:1)
  layerIcon: "ic shrink-0 text-fg-subtle",                               // 14px; component/instance: text-component
  layerTail: "ml-auto hidden h-full items-center group-hover/row:flex [&_button]:size-[24px]", // lock/eye, vertically centred
  indent: (depth: number) => ({ paddingLeft: depth * 16 }),

  // ── Fields ────────────────────────────────────────────────────────────
  field: "flex h-(--field-h) min-w-0 items-center gap-[6px] rounded-md bg-field px-[8px] text-caption text-fg tnum transition-[box-shadow,background-color] duration-fast hover:shadow-[inset_0_0_0_1px_var(--color-line)] hover:duration-0 focus-within:bg-panel focus-within:shadow-focus-field focus-within:duration-0",
  fieldInput: "min-w-0 flex-1 bg-transparent outline-none focus-visible:outline-none placeholder:text-fg-faint",
  fieldPrefix: "grid w-[12px] shrink-0 cursor-ew-resize place-items-center text-micro font-medium text-fg-subtle [&_svg]:text-fg-subtle", // scrub handle
  fieldSuffix: "flex items-center gap-[2px] text-micro text-fg-subtle",  // "Fixed ⌄", "Gap", "%"
  fieldInvalid: "shadow-[inset_0_0_0_1px_var(--color-danger)]",
  paintRow: "col-span-2 pl-[6px] pr-[2px] gap-[8px]",                    // + field; swatch · value · opacity · eye; col 3 = remove (−)
  swatch: "size-[16px] shrink-0 rounded-sm shadow-swatch",
  tokenChip: "inline-flex h-[20px] min-w-0 items-center gap-[5px] rounded-sm bg-active pl-[5px] pr-[6px] font-mono text-micro text-fg",
  tokenChipDot: "size-[5px] shrink-0 rotate-45 rounded-[1px] bg-fg-subtle", // the nuqta
  tokenChipComponent: "bg-component-subtle text-component",
  textarea: "ds-textarea",

  // ── Controls ──────────────────────────────────────────────────────────
  segmented: "relative flex h-(--field-h) rounded-md bg-field p-[2px]",
  segmentedThumb: "q-indicator rounded-sm bg-elevated shadow-raised",     // useSlidingIndicator, axis x
  // Items carry q-press: no transition-* utility here, it would replace q-press's list and drop the scale easing.
  segmentedItem: "q-item relative z-[1] grid flex-1 place-items-center rounded-sm text-fg-subtle hover:text-fg-muted aria-checked:text-fg data-[state=on]:text-fg",
  checkbox: "grid size-[14px] shrink-0 place-items-center rounded-sm text-fg-inverse shadow-[inset_0_0_0_1px_var(--color-line-strong)] data-[state=checked]:bg-inverse data-[state=checked]:shadow-none",
  checkboxMark: "q-check",                                                 // <svg class="q-check"><path pathLength={1} d="M20 6 9 17l-5-5"/></svg>
  checkRow: "flex items-center gap-[8px] text-caption text-fg-muted",
  selectTrigger: "q-item flex h-(--field-h) min-w-0 items-center gap-[6px] rounded-md bg-field pl-[8px] pr-[6px] text-caption text-fg hover:shadow-[inset_0_0_0_1px_var(--color-line)] data-[state=open]:shadow-focus-field [&>svg:last-child]:ml-auto [&>svg:last-child]:text-fg-subtle",

  // ── Buttons ───────────────────────────────────────────────────────────
  // Sizes are alternatives, never stacked: Tailwind orders same-property utilities by value, not by
  // class order, so `button` + an `h-[24px]` would stay 28px. Use r.button OR r.buttonSm, plus one
  // variant; a one-off size starts from r.buttonBase and spells out its own height, gap, padding,
  // radius and text size. Variants carry colour and weight only.
  buttonBase: BUTTON_BASE,
  button: `${BUTTON_BASE} h-[28px] gap-[6px] rounded-md px-[10px] text-body`,
  buttonSm: `${BUTTON_BASE} h-[24px] gap-[6px] rounded-md px-[8px] text-caption`,
  buttonPrimary: "bg-inverse font-medium text-fg-inverse shadow-button-invert hover:bg-inverse/90 active:shadow-button-pressed",   // every primary action
  buttonBrand: "bg-accent pl-[8px] font-semibold text-accent-fg shadow-button-accent hover:bg-accent-hover active:bg-accent-press active:shadow-button-pressed", // GENERATE ONLY (pl beats px)
  buttonSecondary: "bg-raised font-medium text-fg shadow-button hover:bg-elevated light:hover:bg-muted",
  buttonGhost: "q-item font-medium text-fg-muted hover:bg-hover hover:text-fg",
  buttonDanger: "bg-danger-subtle font-medium text-danger hover:bg-danger/20",       // destructive confirm (white on danger fails in dark)
  // Same rule: r.iconButton OR r.iconButtonSm; r.iconButtonBase for a one-off size and tone.
  iconButtonBase: ICON_BUTTON_BASE,
  iconButton: `${ICON_BUTTON_BASE} size-[28px] text-fg-muted`,
  iconButtonSm: `${ICON_BUTTON_BASE} size-[24px] text-fg-subtle`,

  // ── Keys ──────────────────────────────────────────────────────────────
  kbdGroup: "inline-flex gap-[2px]",
  // A keycap is kbdBase + one size (kbd | kbdSm) + one skin (kbdSkin | kbdOnInverse): <Kbd/> composes them.
  kbdBase: "inline-grid place-items-center rounded-sm text-micro leading-none font-medium",
  kbd: "h-[18px] min-w-[18px] px-[4px]",
  kbdSm: "h-[16px] min-w-[16px] px-[3px]",
  kbdSkin: "bg-hover text-fg-muted shadow-kbd",
  kbdOnInverse: "bg-fg-inverse/10 text-fg-inverse/60 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-fg-inverse)_12%,transparent)]",
  shortcutText: "ml-auto pl-[24px] text-caption tracking-[0.06em] text-fg-subtle tnum", // menus, context menu, flyouts: plain glyphs

  // ── Surfaces ──────────────────────────────────────────────────────────
  menu: "q-menu z-50 min-w-[180px] rounded-lg bg-elevated p-[4px] shadow-popover outline-none",
  menuItem: "q-item relative flex h-[28px] cursor-default select-none items-center gap-[8px] rounded-md px-[8px] text-body text-fg outline-none data-[highlighted]:bg-active data-[disabled]:pointer-events-none data-[disabled]:text-fg-faint [&_.ic]:text-fg-subtle data-[highlighted]:[&_.ic]:text-fg",
  menuItemDanger: "text-danger data-[highlighted]:bg-danger-subtle [&_kbd]:text-danger",
  menuCheckSlot: "grid w-[12px] shrink-0 place-items-center",
  menuSeparator: "-mx-[4px] my-[4px] h-px bg-line-subtle",
  menuLabel: "px-[8px] pt-[6px] pb-[4px] text-micro font-medium text-fg-subtle",
  contextMenu: "q-menu z-50 w-[240px] rounded-lg bg-elevated p-[4px] shadow-popover outline-none", // icon-less
  popover: "q-pop z-50 rounded-lg bg-elevated p-[8px] shadow-popover outline-none",
  tooltip: "q-tip z-[60] inline-flex h-[26px] items-center gap-[8px] rounded-lg bg-elevated pl-[8px] pr-[4px] text-caption font-medium text-fg shadow-popover", // pr-[8px] when no keys
  toast: "q-toast flex h-[40px] items-center gap-[10px] rounded-xl bg-elevated pl-[10px] pr-[6px] text-body font-medium text-fg shadow-popover",
  toastIcon: "grid size-[20px] place-items-center rounded-full bg-success-subtle text-success", // error: danger-subtle/danger
  toastMeta: "font-normal text-fg-subtle tnum",
  overlay: "q-overlay fixed inset-0 z-50 bg-overlay",                     // modal dialogs only
  dialog: "q-dialog fixed left-1/2 top-[13vh] z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl bg-panel shadow-modal",
  dialogHeader: "flex h-[48px] items-center justify-between border-b border-line-subtle pl-[16px] pr-[8px] text-title font-semibold",
  dialogBody: "p-[16px]",
  dialogFooter: "flex justify-end gap-[8px] border-t border-line-subtle px-[16px] py-[12px]",
  heroTitle: "text-hero font-semibold [font-variation-settings:'opsz'_32]",
  card: "rounded-xl bg-raised shadow-floating",                           // canvas cards: critique, FlagTips, follow
  optionCardSelected: "bg-accent-subtle shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_40%,transparent)]",

  // ── Tags ──────────────────────────────────────────────────────────────
  tag: "inline-flex h-[20px] items-center gap-[4px] rounded-sm px-[6px] text-micro font-medium",
  tagNeutral: "bg-active text-fg-muted",
  tagSuccess: "bg-success-subtle text-success",
  tagWarning: "bg-warning-subtle text-warning",                          // MUST include an icon
  tagDanger: "bg-danger-subtle text-danger",                             // MUST include an icon
  tagAi: "bg-ai-subtle text-ai",                                          // MUST include the AI glyph
  tagComponent: "bg-component-subtle text-component",
  // never a saffron tag

  // ── ⌘K palette (no scrim) ─────────────────────────────────────────────
  palette: "q-palette fixed left-1/2 top-[88px] z-50 w-[min(600px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl bg-elevated shadow-modal",
  paletteInputRow: "flex h-[48px] items-center gap-[10px] border-b border-line-subtle pl-[16px] pr-[12px] [&>svg]:text-fg-subtle",
  paletteInput: "flex-1 bg-transparent text-input text-fg outline-none focus-visible:outline-none placeholder:text-fg-faint",
  paletteList: "q-palette-results relative max-h-[min(480px,60vh)] overflow-y-auto px-[6px] pt-[4px] pb-[6px]",
  paletteGroup: "px-[10px] pt-[10px] pb-[4px] text-micro font-medium text-fg-subtle",
  paletteRow: "relative z-[1] flex h-[36px] items-center gap-[10px] rounded-lg pl-[10px] pr-[8px] text-body text-fg [&>svg]:text-fg-subtle aria-selected:[&>svg]:text-fg",
  paletteHighlight: "q-indicator rounded-lg bg-active shadow-[inset_0_0_0_1px_var(--color-line)]", // data-glide="fast" on pointer, data-instant on keys
  paletteSub: "whitespace-nowrap text-fg-subtle before:mr-[8px] before:text-fg-faint before:content-['·']", // "Pay · Send", "Tool"
  paletteState: "text-caption text-fg-subtle",                               // "Off", "On", "Plans first"
  paletteFooter: "flex h-[36px] items-center gap-[16px] border-t border-line-subtle bg-muted pl-[14px] pr-[12px] text-micro text-fg-subtle",

  // ── Toolbar ───────────────────────────────────────────────────────────
  toolbar: "absolute bottom-[16px] left-1/2 z-[6] flex h-(--toolbar-h) -translate-x-1/2 items-center gap-[2px] rounded-xl bg-raised p-[4px] shadow-floating",
  toolKey: "q-item q-press q-press-icon relative z-[1] flex h-[36px] min-w-[36px] items-center justify-center rounded-lg text-fg-muted hover:text-fg aria-pressed:text-fg-accent [&:not([aria-pressed=true]):hover]:bg-hover",
  toolGroup: "gap-[2px] pl-[8px] pr-[2px]",                                 // slot with a flyout chevron
  toolChevron: "q-chevron grid w-[14px] place-items-center text-fg-subtle", // flips while open; a control, so not fg-faint
  toolIndicator: "q-indicator rounded-lg bg-active shadow-button",          // the ONE neutral key; slides on click, instant on key
  toolText: "gap-[8px] px-[10px] text-body font-medium",                    // Actions ⌘K, Qalam AI /
  toolSep: "mx-[4px] h-[20px] w-px bg-line",
  flyout: "q-flyout z-50 min-w-[184px] rounded-lg bg-elevated p-[4px] shadow-popover", // side="top" sideOffset={10} align="center"
  flyoutPickedIcon: "text-fg-accent",
  penHint: "q-rise absolute bottom-[68px] left-1/2 -translate-x-1/2 flex h-[28px] items-center gap-[10px] rounded-lg bg-elevated px-[10px] text-caption text-fg-muted shadow-popover",

  // ── Qalam AI chat ─────────────────────────────────────────────────────
  chatWindow: "q-chat fixed right-[12px] top-[60px] z-40 flex h-[min(636px,calc(100vh-120px))] w-[360px] flex-col overflow-hidden rounded-xl bg-panel shadow-floating",
  chatHeader: "flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line-subtle pl-[14px] pr-[8px]",
  chatTitle: "text-body font-semibold text-fg",
  chatThread: "inline-flex items-center gap-[2px] text-caption font-medium text-fg-subtle before:mr-[6px] before:text-fg-faint before:content-['·']",
  chatBody: "flex flex-1 flex-col gap-[14px] overflow-y-auto px-[14px] pt-[14px] pb-[8px]",
  chatTurn: "q-rise flex flex-col gap-[10px]",
  chatAiLine: "flex items-start gap-[10px] text-body leading-[20px] text-fg-muted [&_b]:font-medium [&_b]:text-fg [&>svg]:mt-[2px]",
  chatIndent: "ml-[26px]",
  chatUser: "max-w-[272px] self-end rounded-[12px_12px_4px_12px] bg-active px-[12px] py-[8px] text-body leading-[20px] text-fg",
  chatDiff: "flex flex-col gap-[6px] rounded-lg bg-muted px-[10px] py-[8px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]",
  chatSteps: "flex flex-col rounded-lg px-[10px] py-[6px] text-caption shadow-[inset_0_0_0_1px_var(--color-line-subtle)]",
  chatStep: "flex h-[26px] items-center gap-[8px] text-fg-muted data-[state=running]:text-fg data-[state=todo]:text-fg-subtle",
  chatStepTime: "ml-auto text-fg-subtle tnum",                            // "0.8s", "6 / 14"
  chatChip: "inline-flex h-[24px] items-center gap-[6px] rounded-md bg-muted px-[8px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] q-stagger",
  chatStatus: "flex items-center gap-[10px] text-caption font-medium",    // <QalamAIGlyph/> <span class="q-shimmer-text">…</span> <span class="ml-auto font-normal text-fg-subtle tnum">0:12</span>
  composer: "q-ai-ring mx-[10px] mb-[10px] rounded-xl bg-raised focus-within:shadow-focus-field", // data-busy while running (ring + glow replace focus)
  composerInput: "w-full resize-none bg-transparent px-[12px] pt-[12px] pb-[6px] text-body text-fg outline-none focus-visible:outline-none placeholder:text-fg-faint",
  composerBar: "flex items-center gap-[4px] pt-[4px] pr-[6px] pb-[6px] pl-[8px]",
  composerPill: "q-item inline-flex h-[24px] items-center gap-[5px] rounded-md bg-hover px-[7px] text-caption font-medium text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:text-fg",
  stopButton: "h-[26px] gap-[6px] rounded-md pl-[8px] pr-[4px] text-body",  // + buttonBase + buttonPrimary, with an Esc kbdOnInverse

  // ── Panels (AI surfaces: steps · chat · so far, src/ui/chat) ──────────
  panelBackdrop: "grid h-full min-h-0 gap-[8px] bg-app p-[8px]",
  panelBox: "flex min-h-0 flex-col overflow-hidden rounded-xl bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)]",
  panelHead: "flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line-subtle pl-[14px] pr-[8px]",
  panelBoxTitle: "truncate text-body font-semibold text-fg",
  panelDrawer: "q-rise absolute bottom-[8px] right-[8px] top-[8px] z-20 flex w-[min(400px,calc(100%-16px))] shadow-floating",
  stepDot: "grid size-[18px] shrink-0 place-items-center rounded-full text-micro tnum",
  chatViewport: "flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[18px] pt-[18px]",
  chatYou: "max-w-[min(480px,85%)] self-end whitespace-pre-wrap rounded-[12px_12px_4px_12px] bg-active px-[12px] py-[8px] text-body leading-[20px] text-fg",
  chatFooter: "mt-auto flex flex-col gap-[8px] bg-panel pb-[14px] pt-[6px]",           // + "sticky bottom-0" for a composer
  replyChip: "q-item inline-flex h-[28px] items-center gap-[6px] rounded-md bg-raised px-[10px] text-body font-medium text-fg shadow-button hover:bg-elevated light:hover:bg-muted disabled:opacity-50",
  replyChipPrimary: "q-item inline-flex h-[28px] items-center gap-[6px] rounded-md bg-inverse px-[10px] text-body font-medium text-fg-inverse shadow-button-invert hover:bg-inverse/90 disabled:opacity-50",

  // ── Canvas DOM overlays ───────────────────────────────────────────────
  agentTag: "absolute left-[13px] top-[15px] inline-flex h-[20px] items-center whitespace-nowrap rounded-[4px_10px_10px_10px] px-[7px] text-micro font-semibold text-[#141412] shadow-[0_1px_2px_rgb(0_0_0/.25)] [background:var(--ai-gradient-soft)]",
  busyFrame: "q-ai-ring q-ai-frame pointer-events-none absolute rounded-[3px]", // data-busy; positioned at the frame's screen rect
  critiquePill: "q-pop inline-flex h-[28px] items-center gap-[6px] rounded-full bg-raised pl-[8px] pr-[10px] text-caption font-medium text-fg shadow-floating",
  wxhBadge: "h-[18px] rounded-sm bg-selection-strong px-[5px] text-micro leading-[18px] font-semibold text-white tnum", // renderer draws the same white
} as const;

/** The spec's recipes plus small additions other buckets asked for. Import `r` (or `recipes`). */
export const r = {
  ...spec,
  /** Floating chrome over the canvas (toolbar, canvas cards). */
  floating: "rounded-xl bg-raised shadow-floating",
  /** Modal surface (same as dialog without the positioning). */
  modal: "q-dialog rounded-xl bg-panel shadow-modal",
  /** Neutral meta chip (counts, "Draft", context pills). */
  chip: "inline-flex h-[20px] items-center gap-[4px] rounded-sm bg-active px-[6px] text-micro font-medium text-fg-muted",
  /** A neutral selected row in lists that do not mirror canvas selection (chats, pages, sidebar items). */
  selectedRow: "bg-selected font-medium text-fg",
  /** Horizontal hairline. */
  divider: "h-px shrink-0 bg-line-subtle",
  /** Small caption above a group (sentence case, never uppercase tracking). */
  eyebrow: "text-micro font-medium text-fg-subtle",
  /** Links in running text. */
  link: "text-fg underline decoration-fg/40 underline-offset-2 hover:decoration-fg",
  /** Skeleton block while content loads. */
  skeleton: "q-skeleton rounded-md",
} as const;

export const recipes = r;
