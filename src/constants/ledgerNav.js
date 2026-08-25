/**
 * The rittenregistratie pages (#30).
 *
 * Separate from `tabs` because these are real navigations, not tab switches:
 * they mount different roots (see main.jsx), so they are links rather than
 * buttons and the browser handles them.
 *
 * Labels are Dutch and not run through i18n. The pages themselves are Dutch —
 * a rittenregistratie is a Dutch tax record — so translating only the menu
 * entry would promise a translated page that does not exist.
 */
export const ledgerNav = [
  { id: 'trips', href: '/trips', label: 'Ritten' },
  { id: 'places', href: '/places', label: 'Locaties' },
];
