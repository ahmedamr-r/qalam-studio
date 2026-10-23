/**
 * Defaults for systems other than the built-in one. The built-in recipes are tuned to a super-app look
 * (8px corners, a dark tab bar, a header band the content rises over as a sheet…). Those are
 * choices, not neutral starting points: an extraction that doesn't style a component starts from
 * these values instead (the model's readings and the measurements go on top), and older systems
 * are completed with them, so the built-in look doesn't leak into other products.
 *
 * Values are authored token values: references to roles (resolved against the system's own
 * colours, radii and type) or literals.
 */
export const NEUTRAL: Record<string, unknown> = {
  "component.button.radius": "{radius.pill}",
  "component.button.height-lg": "52px",
  "component.button.secondary.fill": "{bg.surface}",
  "component.button.secondary.border-width": "{border-width.none}",
  "component.icon-button.radius": "{radius.md}",
  "component.icon-button.size": "{size.touch-min}",
  "component.input.radius": "{radius.md}",
  "component.search.height": "{component.input.height}",
  "component.search.fill": "{component.input.fill}",
  "component.search.style.icon": "start",
  "component.tag.radius": "{radius.pill}",
  "component.tag.height": "24px",
  "component.tag.padding-x": "{space.200}",
  "component.tag.promo-fill": "{feedback.error}",
  "component.tag.promo-label": "{text.inverse}",
  "component.tag.member-fill": "{bg.surface}",
  "component.tag.member-label": "{text.link}",
  "component.tag.member-border": "{border.subtle}",
  "component.card.brand-fill": "{bg.brand-strong}",
  "component.card.radius": "{radius.lg}",
  "component.card.flat.border-width": "{border-width.none}",
  "component.tile.radius": "{radius.lg}",
  "component.tile.height": "92px",
  "component.tile.icon-fill": "{bg.brand-subtle}",
  "component.tile.icon-size": "40px",
  "component.tile.gap": "8px",
  "component.banner.radius": "{radius.xl}",
  "component.media.radius": "{radius.lg}",
  "component.media.fill": "{bg.brand-subtle}",
  "component.sheet.radius": "{radius.xl}",
  "component.backdrop.fill": {
    kind: "linear",
    angle: 180,
    stops: [
      { color: "{bg.brand-subtle}", position: 0 },
      { color: "{bg.canvas}", position: 1 },
    ],
  },
  "component.backdrop.sheet-radius": "0px",
  "component.nav-bar.fill": "{bg.canvas}",
  "component.nav-bar.border-width": "{border-width.hairline}",
  "component.nav-bar.active": "{icon.brand}",
  "component.nav-bar.inactive": "{icon.secondary}",
  "component.nav-bar.height": "52px",
  "component.alert.radius": "{radius.md}",
  "component.empty.art-fill": "{bg.brand-subtle}",
  "component.empty.art-icon": "{icon.brand}",
};

/** The authored default of a contract path for a system other than the built-in one, if it differs. */
export const neutralOf = (path: string): unknown => NEUTRAL[path];
