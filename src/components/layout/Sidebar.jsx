import { icons } from '../icons/Icons';
import { tabs } from '../../constants/tabs';
import { ledgerNav } from '../../constants/ledgerNav';
import { useTranslation } from '../../i18n';

export function Sidebar({ activeTab, setActiveTab, showSettings, setShowSettings, darkMode }) {
  const { t } = useTranslation();

  return (
    <aside className="hidden lg:block w-56 flex-shrink-0 py-6 pl-4">
      <div className={`sticky top-20 p-4 rounded-xl border ${darkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-zinc-200 shadow-sm'}`}>
        {/* Navigation Menu Items */}
        <nav className="space-y-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setShowSettings(false);
              }}
              className={`w-full px-3 py-2.5 rounded-xl font-medium transition-all flex items-center gap-3 text-sm ${
                activeTab === tab.id && !showSettings
                  ? 'bg-sky-500 text-white'
                  : darkMode
                    ? 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
              }`}
            >
              {icons[tab.id]}
              <span>{t(`tabs.${tab.id}`)}</span>
            </button>
          ))}
        </nav>

        {/* Mileage log — separate roots, so links rather than tabs. */}
        <div className={`my-4 border-t ${darkMode ? 'border-zinc-800' : 'border-zinc-200'}`} />
        <p className={`px-3 pb-1 text-xs font-medium uppercase tracking-wide ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
          Mileage log
        </p>
        <nav className="space-y-1">
          {ledgerNav.map(item => (
            <a
              key={item.id}
              href={item.href}
              className={`w-full px-3 py-2.5 rounded-xl font-medium transition-all flex items-center gap-3 text-sm ${
                darkMode
                  ? 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
              }`}
            >
              {icons[item.id]}
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        {/* Divider */}
        <div className={`my-4 border-t ${darkMode ? 'border-zinc-800' : 'border-zinc-200'}`} />

        {/* Settings */}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`w-full px-3 py-2.5 rounded-xl font-medium transition-all flex items-center gap-3 text-sm ${
            showSettings
              ? 'bg-sky-500 text-white'
              : darkMode
                ? 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
          }`}
        >
          {icons.settings}
          <span>{t('common.settings')}</span>
        </button>
      </div>
    </aside>
  );
}
