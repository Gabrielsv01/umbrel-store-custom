import { useState } from 'react';

interface MenuProps {
  setShowCatalog: React.Dispatch<React.SetStateAction<boolean>>;
  setShowDocs: React.Dispatch<React.SetStateAction<boolean>>;
  setShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  setView: React.Dispatch<React.SetStateAction<'hub' | 'inspector' | 'builder'>>;
  onOpenImages: () => Promise<void>;
  onOpenVolumes: () => Promise<void>;
}

export default function Menu({
  setShowCatalog,
  setShowDocs,
  setShowForm,
  setView,
  onOpenImages,
  onOpenVolumes,
}: Readonly<MenuProps>) {
  const [showMenu, setShowMenu] = useState(false);

  const handleMenuClose = () => setShowMenu(false);
  const handleMenuClick = (callback: (() => void) | (() => Promise<void>)) => {
    Promise.resolve(callback()).finally(handleMenuClose);
  };

  const menuItems = [
    { label: 'Volumes', onClick: onOpenVolumes },
    { label: 'Images', onClick: onOpenImages },
    { label: 'Catalog', onClick: () => setShowCatalog(true) },
    { label: 'API Docs', onClick: () => setShowDocs(true) },
  ];

  return (
    <div className="flex items-center gap-2">
      {/* Hub Button */}
      <button
        onClick={() => handleMenuClick(() => setView('hub'))}
        className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
        title="Back to Hub"
      >
        📦 Hub
      </button>

      {/* Inspector Button */}
      <button
        onClick={() => handleMenuClick(() => setView('inspector'))}
        className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
        title="Open MCP Inspector"
      >
        🔍 Inspector
      </button>

      {/* Builder Button */}
      <button
        onClick={() => handleMenuClick(() => setView('builder'))}
        className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
        title="Open MCP Builder"
      >
        🔧 Builder
      </button>

      {/* Menu Button */}
      <button
        type="button"
        onClick={() => setShowMenu((prev) => !prev)}
        className="rounded-lg bg-gray-800 px-2 py-1 text-lg text-gray-300 transition-colors hover:bg-gray-700"
        title="Open actions menu"
      >
        ≡
      </button>

      {showMenu && (
        <>
          {/* Overlay to close menu on click */}
          <button
            type="button"
            className="fixed inset-0 z-10"
            onClick={handleMenuClose}
            aria-label="Close menu"
          />

          {/* Desktop dropdown menu */}
          <div className="absolute right-36 top-20 z-20 hidden min-w-40 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-950 shadow-2xl md:flex">
            {menuItems.map((item) => (
              <button
                key={item.label}
                onClick={() => handleMenuClick(item.onClick)}
                className="bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700"
              >
                {item.label}
              </button>
            ))}
            <button
              onClick={() => handleMenuClick(() => setShowForm(true))}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              <span className="text-base leading-none">+</span> Deploy MCP
            </button>
          </div>

          {/* Mobile bottom sheet menu */}
          <dialog
            className="fixed bottom-0 left-0 right-0 z-20 flex w-full flex-col gap-3 rounded-t-2xl border-t border-gray-700 bg-gray-950 p-4 shadow-2xl md:hidden sm:max-w-sm sm:left-auto sm:right-0"
            open
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-100">Menu</h3>
              <button
                type="button"
                onClick={handleMenuClose}
                className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => handleMenuClick(item.onClick)}
                  className="w-full rounded-lg bg-gray-800 px-4 py-3 text-left text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700"
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleMenuClick(() => setShowForm(true))}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500"
              >
                <span className="text-base leading-none">+</span> Deploy MCP
              </button>
            </div>
          </dialog>
        </>
      )}
    </div>
  );
}
