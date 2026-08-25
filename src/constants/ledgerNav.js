/**
 * The rittenregistratie pages (#30).
 *
 * Separate from `tabs` because these are real navigations, not tab switches:
 * they mount different roots (see main.jsx), so they are links rather than
 * buttons and the browser handles them.
 *
 * Labels are English and not run through i18n. The pages are English too, so
 * a menu entry never promises a translated page that does not exist. The
 * DOMAIN terms stay Dutch where they are Dutch — the schema, the docs and the
 * wayfinder map all say rittenregistratie — because that is the name of the
 * thing being recorded, not interface text.
 */
export const ledgerNav = [
  { id: 'trips', href: '/trips', label: 'Trips' },
  { id: 'places', href: '/places', label: 'Places' },
];
