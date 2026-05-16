import { useState, useEffect, useRef } from 'react';

interface MenuProps {
  setShowCatalog: React.Dispatch<React.SetStateAction<boolean>>;
  setShowDocs: React.Dispatch<React.SetStateAction<boolean>>;
  setShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  setView: React.Dispatch<
    React.SetStateAction<'hub' | 'inspector' | 'builder' | 'custom-tools'>
  >;
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
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!showMenu) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        buttonRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowMenu(false);
      }
    };

    setTimeout(() => {
      if (!buttonRef.current || !menuRef.current) return;

      const buttonRect = buttonRef.current.getBoundingClientRect();
      const menuRect = menuRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      let top = buttonRect.bottom + 8;
      let left = buttonRect.right - menuRect.width;

      if (top + menuRect.height > viewportHeight) {
        top = buttonRect.top - menuRect.height - 8;
      }

      if (left + menuRect.width > viewportWidth) {
        left = viewportWidth - menuRect.width - 8;
      }

      if (left < 0) {
        left = 8;
      }

      setMenuPosition({ top, left });
    }, 0);

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

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
      {/* Navigation Buttons - Hidden on Mobile */}
      {!isMobile && (
        <>
          <button
            onClick={() => handleMenuClick(() => setView('hub'))}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
            title="Back to Hub"
          >
            📦 Hub
          </button>

          <button
            onClick={() => handleMenuClick(() => setView('inspector'))}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
            title="Open MCP Inspector"
          >
            🔍 Inspector
          </button>

          <button
            onClick={() => handleMenuClick(() => setView('builder'))}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
            title="Open MCP Builder"
          >
            🔧 Builder
          </button>

          <button
            onClick={() => handleMenuClick(() => setView('custom-tools'))}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
            title="Custom Tools"
          >
            🛠️ Custom Tools
          </button>
        </>
      )}

      {/* Menu Button */}
      <button
        ref={buttonRef}
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

          {/* Dropdown menu */}
          <div
            ref={menuRef}
            className="fixed z-20 min-w-40 flex flex-col overflow-y-auto rounded-xl border border-gray-700 bg-gray-950 shadow-2xl max-h-96 transition-opacity"
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
            }}
          >
            {/* Navigation items on mobile */}
            {isMobile && (
              <>
                <button
                  onClick={() => handleMenuClick(() => setView('hub'))}
                  className="px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-gray-900"
                >
                  📦 Hub
                </button>
                <button
                  onClick={() => handleMenuClick(() => setView('inspector'))}
                  className="px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-gray-900"
                >
                  🔍 Inspector
                </button>
                <button
                  onClick={() => handleMenuClick(() => setView('builder'))}
                  className="px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-gray-900"
                >
                  🔧 Builder
                </button>
                <button
                  onClick={() => handleMenuClick(() => setView('custom-tools'))}
                  className="px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-gray-900"
                >
                  🛠️ Custom Tools
                </button>
              </>
            )}

            {/* Menu items */}
            {menuItems.map((item) => (
              <button
                key={item.label}
                onClick={() => handleMenuClick(item.onClick)}
                className="px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-gray-900"
              >
                {item.label}
              </button>
            ))}
            <button
              onClick={() => handleMenuClick(() => setShowForm(true))}
              className="px-3 py-2 text-left text-xs text-blue-400 transition-colors hover:bg-gray-900 flex items-center gap-2"
            >
              <span>+</span> Deploy MCP
            </button>
          </div>
        </>
      )}
    </div>
  );
}
