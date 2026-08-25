/**
 * The app's chrome, worn by the two rittenregistratie pages (#30).
 *
 * The ledger and the place book mount instead of App (see main.jsx), so they
 * inherit none of its layout. This gives them the same gradient ground, the
 * same sticky blurred header and the same sky-500 mark, so moving between the
 * dashboard and the ledger does not feel like leaving the application.
 *
 * Deliberately not the full App shell: no tab sidebar. The dashboard's tabs
 * read localStorage and the ledger reads Postgres (#9), so a shared sidebar
 * would imply a navigation that does not exist yet. One link back is honest;
 * a full tab rail would not be.
 */

import { useThemeMode } from '../../theme';

/** The same mark the dashboard header uses, so the two read as one product. */
function Mark() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500 text-white">
      <svg className="h-5 w-5" viewBox="0 0 381.678 381.678" fill="currentColor" aria-hidden="true">
        <path d="M374.989,190.691l-10.216-6.854l-7.761-21.44c-1.352-3.734-4.785-6.315-8.749-6.575l-107.727-7.065l-31.874-22.369c-16.114-11.308-36.34-15.188-55.494-10.644l-23.529,5.583c-25.215,5.982-49.437,15.61-71.846,28.436c-0.313-0.03-0.629-0.048-0.95-0.048H29.985l-9.074-9.074c-3.905-3.905-10.237-3.905-14.143,0c-3.905,3.905-3.905,10.237,0,14.143l12.003,12.003c1.875,1.875,4.419,2.929,7.071,2.929h1.918c-5.84,4.469-11.506,9.177-16.971,14.122c-2.095,1.896-3.291,4.589-3.291,7.415v8.262L1.04,212.55c-0.684,1.38-1.04,2.9-1.04,4.44c0,12.406,10.093,22.499,22.499,22.499h36.258c4.41,16.286,19.31,28.304,36.971,28.304s32.562-12.018,36.971-28.304h123.539c4.41,16.286,19.31,28.304,36.971,28.304s32.562-12.018,36.971-28.304h24.834c10.034,0,18.94-6.746,21.659-16.406l4.435-15.768C382.881,201.017,380.422,194.336,374.989,190.691z M357.421,217.666c-0.302,1.073-1.291,1.823-2.406,1.823h-24.834c-4.41-16.286-19.31-28.304-36.971-28.304s-32.562,12.018-36.971,28.304H132.699c-4.41-16.286-19.31-28.304-36.971-28.304s-32.562,12.018-36.971,28.304H22.499c-0.846,0-1.596-0.423-2.048-1.068l6.009-12.126c0.684-1.38,1.04-2.9,1.04-4.44v-6.113c30.51-26.634,67.328-45.602,106.755-54.955l23.529-5.583c13.597-3.226,27.952-0.471,39.389,7.555l34.167,23.979c1.5,1.053,3.261,1.673,5.09,1.793l104,6.821l6.65,18.371c0.724,1.999,2.066,3.716,3.831,4.9l9.982,6.697L357.421,217.666z M311.514,229.489c0,10.093-8.211,18.304-18.304,18.304s-18.304-8.211-18.304-18.304s8.211-18.304,18.304-18.304S311.514,219.396,311.514,229.489z M114.032,229.489c0,10.093-8.211,18.304-18.304,18.304s-18.304-8.211-18.304-18.304s8.211-18.304,18.304-18.304S114.032,219.396,114.032,229.489z" />
      </svg>
    </div>
  );
}

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/trips', label: 'Ritten' },
  { href: '/places', label: 'Locaties' },
];

export default function LedgerShell({
  title,
  subtitle,
  active,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  /** Which nav entry is the page you are on. */
  active: '/trips' | '/places';
  /** Page-level controls, rendered in the header beside the nav. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  // Called for its side effect: it is what puts `.dark` on <html> when the
  // dashboard is not mounted to do it.
  useThemeMode();

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-100 via-zinc-50 to-white text-zinc-900 transition-colors duration-200 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto max-w-7xl px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Mark />
              <div>
                <h1 className="text-lg font-bold text-zinc-900 dark:text-white">{title}</h1>
                <p className="text-xs text-zinc-500">{subtitle}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {actions}
              <nav className="flex items-center gap-1 rounded-xl bg-zinc-200/60 p-1 dark:bg-zinc-900/70">
                {NAV.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className={[
                      'rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
                      item.href === active
                        ? 'bg-sky-500 text-white'
                        : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white',
                    ].join(' ')}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

/**
 * The card the dashboard uses everywhere: rounded-xl, one border, a faint fill.
 * Exported so the two pages cannot drift from it independently.
 */
export function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50 ${className}`}
    >
      {children}
    </div>
  );
}

/** The dashboard's primary control shape: sky fill when on, quiet when off. */
export function PillButton({
  on,
  disabled,
  onClick,
  title,
  tone = 'sky',
  children,
}: {
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  tone?: 'sky' | 'plain' | 'warn';
  children: React.ReactNode;
}) {
  const off =
    tone === 'warn'
      ? 'border border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400'
      : 'border border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white';

  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={[
        'rounded-lg px-2.5 py-1 text-xs font-medium transition-all disabled:opacity-40',
        on ? 'bg-sky-500 text-white' : off,
      ].join(' ')}
    >
      {children}
    </button>
  );
}
