import { useState } from 'react';
import { useImages } from '../hooks/useImages';
import { useVolumes } from '../hooks/useVolumes';

export default function Menu({
  setShowCatalog,
  setShowDocs,
  setShowForm,
}: {
  setShowCatalog: React.Dispatch<React.SetStateAction<boolean>>;
  setShowDocs: React.Dispatch<React.SetStateAction<boolean>>;
  setShowForm: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const { openImages } = useImages();

  const { openVolumes } = useVolumes();

  return (
    <div>
      <button
        type="button"
        onClick={() => setShowMenu((prev) => !prev)}
        className="rounded-lg bg-gray-800 px-2 py-1 text-sm text-gray-300 transition-colors hover:bg-gray-700"
        title="Open actions menu"
      >
        ≡
      </button>

      {showMenu && (
        <div className="absolute right-0 top-10 z-10 flex min-w-40 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-950 shadow-2xl">
          <button
            onClick={openVolumes}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700"
          >
            Volumes
          </button>
          <button
            onClick={openImages}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700"
          >
            Images
          </button>
          <button
            onClick={() => setShowCatalog(true)}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700"
          >
            Catalog
          </button>
          <button
            onClick={() => setShowDocs(true)}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700"
          >
            API Docs
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            <span className="text-base leading-none">+</span> Deploy MCP
          </button>
        </div>
      )}
    </div>
  );
}
